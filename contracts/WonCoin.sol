// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title WonCoin - 발행자 통제형 원화 스테이블코인 (ERC-20, 1코인 = 1원)
/// @notice 실제 법정화폐 연동 스테이블코인의 구조를 단순화해 재현한 학습용 코드.
///         - 충전: 이용자가 '충전 요청' → 발행 담당이 (원화 입금을 확인했다고 보고) 승인 → 새로 발행(mint)
///         - 환불: 이용자가 '환불 요청' → 코인이 컨트랙트에 보관(에스크로) → 승인 시 소각(burn), 거절 시 반환
///         - 준법: 계좌 동결·해제, 동결 자산 강제 소각, 전체 거래 일시정지
///         - 공시: 발행 담당이 준비자산 규모와 근거를 체인에 기록
///         모든 조치는 이벤트로 남아 누구나(감독기관 포함) 이더스캔 등에서 사후 감사할 수 있다.
contract WonCoin {
    // ---- ERC-20 ----
    string public constant name = unicode"감독실험 원화코인";
    string public constant symbol = "sKRW";
    uint8 public constant decimals = 0;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ---- 권한 ----
    bytes32 public constant MINTER = keccak256("MINTER");
    bytes32 public constant COMPLIANCE = keccak256("COMPLIANCE");
    bytes32 public constant PAUSER = keccak256("PAUSER");
    address public owner;
    mapping(bytes32 => mapping(address => bool)) public hasRole;
    mapping(address => bool) public frozen;
    bool public paused;

    // ---- 충전·환불 요청 ----
    uint256 public constant MAX_REQUEST = 10_000_000; // 1회 최대 1천만 원
    struct Request {
        address user;
        bool redeem;     // false = 충전(발행), true = 환불(소각)
        uint8 status;    // 0 대기, 1 승인, 2 거절
        uint64 time;
        uint256 amount;
        string memo;
    }
    Request[] public requests;

    // ---- 준비자산 공시 ----
    struct Attestation {
        uint256 reserve;
        uint256 supplyAtTime;
        uint64 time;
        string evidence;
    }
    Attestation[] public attestations;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Memo(address indexed from, address indexed to, uint256 value, string memo);
    event RequestCreated(uint256 indexed id, address indexed user, bool redeem, uint256 amount, string memo);
    event RequestResolved(uint256 indexed id, address indexed user, bool redeem, bool approved, uint256 amount, address by, string note);
    event Minted(address indexed by, address indexed to, uint256 amount, string memo);
    event Burned(address indexed by, address indexed from, uint256 amount, string memo);
    event Frozen(address indexed by, address indexed account, string reason);
    event Unfrozen(address indexed by, address indexed account, string reason);
    event FrozenFundsWiped(address indexed by, address indexed account, uint256 amount, string reason);
    event Paused(address indexed by, string reason);
    event Unpaused(address indexed by, string reason);
    event RoleChanged(bytes32 indexed role, address indexed account, bool granted, address indexed by);
    event ReserveAttested(uint256 indexed index, uint256 reserve, uint256 supplyAtTime, string evidence);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() { require(msg.sender == owner, "WonCoin: owner only"); _; }
    modifier onlyRole(bytes32 role) { require(hasRole[role][msg.sender], "WonCoin: missing role"); _; }

    constructor() {
        owner = msg.sender;
        _setRole(MINTER, msg.sender, true);
        _setRole(COMPLIANCE, msg.sender, true);
        _setRole(PAUSER, msg.sender, true);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ---- ERC-20 ----
    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    /// @notice 메모를 붙인 송금. 메모는 이벤트로 남아 이더스캔에서도 보인다.
    function transferWithMemo(address to, uint256 value, string calldata memo) external returns (bool) {
        require(bytes(memo).length <= 200, "WonCoin: memo too long");
        _transfer(msg.sender, to, value);
        emit Memo(msg.sender, to, value, memo);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= value, "WonCoin: allowance too low");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        require(!paused, "WonCoin: paused");
        require(!frozen[from], "WonCoin: sender frozen");
        require(!frozen[to], "WonCoin: recipient frozen");
        require(to != address(0), "WonCoin: to zero address");
        require(balanceOf[from] >= value, "WonCoin: balance too low");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    // ---- 충전·환불 요청 ----
    function requestDeposit(uint256 amount, string calldata memo) external returns (uint256 id) {
        require(amount > 0 && amount <= MAX_REQUEST, "WonCoin: amount 1 ~ 10,000,000");
        require(bytes(memo).length <= 200, "WonCoin: memo too long");
        return _newRequest(false, amount, memo);
    }

    /// @notice 환불 요청 즉시 코인이 컨트랙트로 옮겨져 보관된다 (이중 사용 방지).
    function requestRedeem(uint256 amount, string calldata memo) external returns (uint256 id) {
        require(amount > 0 && amount <= MAX_REQUEST, "WonCoin: amount 1 ~ 10,000,000");
        require(bytes(memo).length <= 200, "WonCoin: memo too long");
        _transfer(msg.sender, address(this), amount);
        return _newRequest(true, amount, memo);
    }

    function _newRequest(bool redeem, uint256 amount, string calldata memo) private returns (uint256 id) {
        requests.push(Request(msg.sender, redeem, 0, uint64(block.timestamp), amount, memo));
        id = requests.length - 1;
        emit RequestCreated(id, msg.sender, redeem, amount, memo);
    }

    function approveRequest(uint256 id, string calldata note) external onlyRole(MINTER) {
        Request storage r = requests[id];
        require(r.status == 0, "WonCoin: already resolved");
        r.status = 1;
        if (r.redeem) {
            balanceOf[address(this)] -= r.amount;
            totalSupply -= r.amount;
            emit Transfer(address(this), address(0), r.amount);
            emit Burned(msg.sender, r.user, r.amount, note);
        } else {
            _mint(r.user, r.amount, note);
        }
        emit RequestResolved(id, r.user, r.redeem, true, r.amount, msg.sender, note);
    }

    function rejectRequest(uint256 id, string calldata note) external onlyRole(MINTER) {
        Request storage r = requests[id];
        require(r.status == 0, "WonCoin: already resolved");
        r.status = 2;
        if (r.redeem) {
            // 보관 중이던 코인을 돌려준다 (정지·동결 중에도 반환은 허용)
            balanceOf[address(this)] -= r.amount;
            balanceOf[r.user] += r.amount;
            emit Transfer(address(this), r.user, r.amount);
        }
        emit RequestResolved(id, r.user, r.redeem, false, r.amount, msg.sender, note);
    }

    function requestCount() external view returns (uint256) {
        return requests.length;
    }

    // ---- 발행 담당 직접 조치 ----
    function mint(address to, uint256 amount, string calldata memo) external onlyRole(MINTER) {
        _mint(to, amount, memo);
    }

    function _mint(address to, uint256 amount, string calldata memo) private {
        require(!frozen[to], "WonCoin: recipient frozen");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
        emit Minted(msg.sender, to, amount, memo);
    }

    function attestReserve(uint256 reserve, string calldata evidence) external onlyRole(MINTER) {
        attestations.push(Attestation(reserve, totalSupply, uint64(block.timestamp), evidence));
        emit ReserveAttested(attestations.length - 1, reserve, totalSupply, evidence);
    }

    function attestationCount() external view returns (uint256) {
        return attestations.length;
    }

    // ---- 준법 통제 ----
    function freeze(address account, string calldata reason) external onlyRole(COMPLIANCE) {
        frozen[account] = true;
        emit Frozen(msg.sender, account, reason);
    }

    function unfreeze(address account, string calldata reason) external onlyRole(COMPLIANCE) {
        frozen[account] = false;
        emit Unfrozen(msg.sender, account, reason);
    }

    /// @notice 동결된 계좌의 잔액을 강제로 소각 (예: 법원 명령, 범죄 수익)
    function wipeFrozenFunds(address account, string calldata reason) external onlyRole(COMPLIANCE) {
        require(frozen[account], "WonCoin: account not frozen");
        uint256 amount = balanceOf[account];
        balanceOf[account] = 0;
        totalSupply -= amount;
        emit Transfer(account, address(0), amount);
        emit FrozenFundsWiped(msg.sender, account, amount, reason);
    }

    function pause(string calldata reason) external onlyRole(PAUSER) {
        paused = true;
        emit Paused(msg.sender, reason);
    }

    function unpause(string calldata reason) external onlyRole(PAUSER) {
        paused = false;
        emit Unpaused(msg.sender, reason);
    }

    // ---- 권한 관리 ----
    function setRole(bytes32 role, address account, bool granted) external onlyOwner {
        _setRole(role, account, granted);
    }

    function _setRole(bytes32 role, address account, bool granted) private {
        hasRole[role][account] = granted;
        emit RoleChanged(role, account, granted, msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
