// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Forwarder.sol";

interface ISgwBets {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function receiveWithAuthorization(
        address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s
    ) external;
}

/// @title Bets - 수원더헤븐 내기판
/// @notice 누구나 질문과 선택지로 내기를 열고, 마감 전까지 박형원(sgw)을 건다.
///   마감 뒤 만든 사람이 결과를 정하면, 이긴 선택지에 건 사람들이 전체 판돈을 건 금액 비율대로 나눠 가진다.
///   - 이긴 쪽에 건 사람이 아무도 없으면 전원 환불
///   - 취소되면 전원 환불 (만든 사람은 판돈이 없을 때만, 관리자는 정산이 시작되기 전까지 언제나)
///   - 관리자는 정산이 하나도 나가기 전까지 결과를 바로잡을 수 있다 (만든 사람이 엉뚱한 결과를 냈을 때)
///   돈을 거는 것은 EIP-3009 서명(betWithAuthorization)이라 참여자는 서명만 하고 수수료는 누구든 대신 낸다.
///   정산 받기(claimFor)도 누구든 대신 실행할 수 있어서, 운영 서버가 결과 확정 뒤 일괄로 나눠 준다.
contract Bets is ERC2771Context {
    ISgwBets public immutable coin;
    address public admin;

    uint8 public constant OPEN = 0;
    uint8 public constant RESOLVED = 1;
    uint8 public constant CANCELLED = 2;

    struct Bet {
        address creator;
        uint64 createdAt;
        uint64 closesAt;
        uint64 resolvedAt;
        uint8 state;
        uint8 winner;
        uint256 pool;
        uint256 paidOut;
        string question;
        string[] options;
    }

    Bet[] private _bets; // id = 인덱스 + 1
    mapping(uint256 => uint256[]) private _optionPool;
    mapping(uint256 => mapping(address => uint256[])) private _stakes;
    mapping(uint256 => mapping(address => uint256)) public stakeTotal;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event Created(uint256 indexed id, address indexed creator, string question, string[] options, uint64 closesAt);
    event Placed(uint256 indexed id, address indexed who, uint8 option, uint256 amount);
    event Resolved(uint256 indexed id, uint8 option, address by);
    event Cancelled(uint256 indexed id, address by);
    event Claimed(uint256 indexed id, address indexed who, uint256 amount);
    event AdminChanged(address admin);

    constructor(address coin_, address forwarder_, address admin_) ERC2771Context(forwarder_) {
        coin = ISgwBets(coin_);
        admin = admin_;
        emit AdminChanged(admin_);
    }

    function setAdmin(address a) external {
        require(_msgSender() == admin, "Bets: admin only");
        admin = a;
        emit AdminChanged(a);
    }

    // ───── 열기 ─────
    function create(string calldata question, string[] calldata options, uint64 closesAt) external returns (uint256 id) {
        require(bytes(question).length >= 1 && bytes(question).length <= 200, "Bets: question 1-200 bytes");
        require(options.length >= 2 && options.length <= 8, "Bets: 2-8 options");
        for (uint256 i = 0; i < options.length; i++) {
            require(bytes(options[i]).length >= 1 && bytes(options[i]).length <= 60, "Bets: option 1-60 bytes");
        }
        require(closesAt >= block.timestamp + 60 && closesAt <= block.timestamp + 60 days, "Bets: close in 1 min - 60 days");
        Bet storage b = _bets.push();
        b.creator = _msgSender();
        b.createdAt = uint64(block.timestamp);
        b.closesAt = closesAt;
        b.question = question;
        b.options = options;
        id = _bets.length;
        _optionPool[id] = new uint256[](options.length);
        emit Created(id, b.creator, question, options, closesAt);
    }

    // ───── 걸기 ─────
    /// @notice 서명 결제로 걸기. 서명 내용은 "from=거는 사람, to=내기판, value=금액" 이어야 한다.
    function betWithAuthorization(
        uint256 id, uint8 option,
        address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s
    ) external {
        _place(id, option, from, value);
        coin.receiveWithAuthorization(from, address(this), value, validAfter, validBefore, nonce, v, r, s);
    }

    /// @notice (ERC-20 표준) 미리 결제 허용(approve)한 뒤 걸기
    function bet(uint256 id, uint8 option, uint256 value) external {
        address from = _msgSender();
        _place(id, option, from, value);
        require(coin.transferFrom(from, address(this), value), "Bets: payment failed");
    }

    function _place(uint256 id, uint8 option, address from, uint256 value) private {
        Bet storage b = _bet(id);
        require(b.state == OPEN && block.timestamp < b.closesAt, "Bets: betting closed");
        require(option < b.options.length, "Bets: no such option");
        require(value > 0, "Bets: amount must be > 0");
        uint256[] storage st = _stakes[id][from];
        if (st.length == 0) {
            for (uint256 i = 0; i < b.options.length; i++) st.push(0);
        }
        st[option] += value;
        stakeTotal[id][from] += value;
        _optionPool[id][option] += value;
        b.pool += value;
        emit Placed(id, from, option, value);
    }

    // ───── 결과 · 취소 ─────
    function resolve(uint256 id, uint8 option) external {
        Bet storage b = _bet(id);
        require(_msgSender() == b.creator, "Bets: creator only");
        require(b.state == OPEN, "Bets: already settled");
        require(block.timestamp >= b.closesAt, "Bets: not closed yet");
        _setResult(id, b, option);
    }

    /// @notice 관리자가 결과를 정하거나 바로잡는다. 정산이 하나라도 나간 뒤에는 바꿀 수 없다.
    function adminResolve(uint256 id, uint8 option) external {
        Bet storage b = _bet(id);
        require(_msgSender() == admin, "Bets: admin only");
        require(b.state != CANCELLED, "Bets: cancelled");
        require(b.paidOut == 0, "Bets: payouts already started");
        require(block.timestamp >= b.closesAt, "Bets: not closed yet");
        _setResult(id, b, option);
    }

    function _setResult(uint256 id, Bet storage b, uint8 option) private {
        require(option < b.options.length, "Bets: no such option");
        b.state = RESOLVED;
        b.winner = option;
        b.resolvedAt = uint64(block.timestamp);
        emit Resolved(id, option, _msgSender());
    }

    function cancel(uint256 id) external {
        Bet storage b = _bet(id);
        address who = _msgSender();
        require(b.paidOut == 0, "Bets: payouts already started");
        if (who == admin) {
            require(b.state != CANCELLED, "Bets: already cancelled");
        } else {
            require(who == b.creator, "Bets: creator or admin only");
            require(b.state == OPEN && b.pool == 0, "Bets: creator can cancel only before any bet");
        }
        b.state = CANCELLED;
        emit Cancelled(id, who);
    }

    // ───── 정산 ─────
    /// @notice 받을 금액: 취소면 건 돈 전부, 이긴 사람이 없으면 건 돈 전부, 아니면 (이긴 쪽에 건 돈 × 전체 판돈 ÷ 이긴 쪽 판돈)
    function claimable(uint256 id, address who) public view returns (uint256) {
        Bet storage b = _bet(id);
        if (claimed[id][who] || b.state == OPEN) return 0;
        uint256 total = stakeTotal[id][who];
        if (total == 0) return 0;
        if (b.state == CANCELLED) return total;
        uint256 winPool = _optionPool[id][b.winner];
        if (winPool == 0) return total;
        return (_stakes[id][who][b.winner] * b.pool) / winPool;
    }

    function claim(uint256 id) external returns (uint256) {
        return claimFor(id, _msgSender());
    }

    /// @notice 누구든 대신 실행할 수 있다. 돈은 언제나 당사자(who)에게 간다.
    function claimFor(uint256 id, address who) public returns (uint256 amount) {
        amount = claimable(id, who);
        require(amount > 0, "Bets: nothing to claim");
        claimed[id][who] = true;
        _bet(id).paidOut += amount;
        require(coin.transfer(who, amount), "Bets: payout failed");
        emit Claimed(id, who, amount);
    }

    // ───── 조회 ─────
    function betCount() external view returns (uint256) { return _bets.length; }
    function getBet(uint256 id) external view returns (Bet memory) { return _bet(id); }
    function optionPools(uint256 id) external view returns (uint256[] memory) { _bet(id); return _optionPool[id]; }
    function stakesOf(uint256 id, address who) external view returns (uint256[] memory) { _bet(id); return _stakes[id][who]; }

    function _bet(uint256 id) private view returns (Bet storage) {
        require(id >= 1 && id <= _bets.length, "Bets: no such bet");
        return _bets[id - 1];
    }
}
