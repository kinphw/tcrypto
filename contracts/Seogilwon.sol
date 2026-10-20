// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SeogilwonV1 - 원화 스테이블코인 '박형원(phw)' 구현 1판
/// @notice 서클(Circle)의 USDC(FiatToken)와 테더의 USDT 구조를 단순화해 재현했다.
///         이 컨트랙트는 '구현(implementation)'이고, 이용자는 프록시(SgwProxy) 주소를 쓴다.
///         잔액 등 모든 데이터는 프록시의 저장공간에 있고, 프록시가 이 코드를 빌려 실행(delegatecall)한다.
///         → 발행사가 프록시가 가리키는 구현을 바꾸면(업그레이드) 같은 주소·같은 잔액에 새 규칙이 적용된다.
///
///  역할 (USDC 와 같은 구조)
///   - owner        : 역할 담당자 임명·교체
///   - masterMinter : 발행 담당자(minter)를 지정하고 각자의 '발행 한도'를 정함
///   - minter       : 한도 안에서만 발행, 자기 잔액에서 소각(상환 처리)
///   - pauser       : 전체 거래 일시정지
///   - blacklister  : 블랙리스트 등록·해제, (USDT 처럼) 블랙리스트 자금 소각
///
///  수수료 대납 (USDC 와 같은 표준)
///   - EIP-2612 permit                : 서명으로 '결제 허용(approve)'
///   - EIP-3009 transferWithAuthorization / receiveWithAuthorization : 서명으로 송금·결제
///     이용자는 서명만 하고(수수료 0), 그 서명을 누구든 대신 블록체인에 올리며 수수료를 낸다.
contract SeogilwonV1 {
    // ───── 저장공간 (프록시 저장공간에 이 순서로 놓인다 — 업그레이드해도 순서를 바꾸면 안 됨) ─────
    bool private _initialized;
    string public name;
    string public symbol;
    string public currency;
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public owner;
    address public masterMinter;
    address public pauser;
    address public blacklister;
    bool public paused;
    mapping(address => bool) public isMinter;
    mapping(address => uint256) public minterAllowance;
    mapping(address => bool) public isBlacklisted;
    mapping(address => uint256) public nonces; // EIP-2612
    mapping(address => mapping(bytes32 => bool)) public authorizationState; // EIP-3009
    struct Attestation {
        uint256 reserve;
        uint256 supplyAtTime;
        uint64 time;
        string evidence;
    }
    Attestation[] public attestations;

    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");
    bytes32 public constant CANCEL_AUTHORIZATION_TYPEHASH = keccak256("CancelAuthorization(address authorizer,bytes32 nonce)");

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Memo(address indexed from, address indexed to, uint256 value, string memo);
    event Mint(address indexed minter, address indexed to, uint256 amount, string memo);
    event Burn(address indexed burner, uint256 amount, string memo);
    event MinterConfigured(address indexed minter, uint256 minterAllowedAmount);
    event MinterRemoved(address indexed oldMinter);
    event Blacklisted(address indexed account, string reason);
    event UnBlacklisted(address indexed account, string reason);
    event BlackFundsDestroyed(address indexed account, uint256 amount, string reason);
    event Pause(string reason);
    event Unpause(string reason);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MasterMinterChanged(address indexed newMasterMinter);
    event PauserChanged(address indexed newPauser);
    event BlacklisterChanged(address indexed newBlacklister);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);
    event ReserveAttested(uint256 indexed index, uint256 reserve, uint256 supplyAtTime, string evidence);

    modifier onlyOwner() { require(msg.sender == owner, "phw: caller is not the owner"); _; }
    modifier onlyMasterMinter() { require(msg.sender == masterMinter, "phw: caller is not the masterMinter"); _; }
    modifier onlyMinters() { require(isMinter[msg.sender], "phw: caller is not a minter"); _; }
    modifier onlyPauser() { require(msg.sender == pauser, "phw: caller is not the pauser"); _; }
    modifier onlyBlacklister() { require(msg.sender == blacklister, "phw: caller is not the blacklister"); _; }
    modifier whenNotPaused() { require(!paused, "phw: paused"); _; }
    modifier notBlacklisted(address a) { require(!isBlacklisted[a], "phw: account is blacklisted"); _; }

    /// @dev 구현 컨트랙트 자체는 직접 쓰지 못하게 잠근다. 실제 데이터는 프록시 쪽에서 initialize 된다.
    constructor() {
        _initialized = true;
    }

    function initialize(string calldata name_, string calldata symbol_, string calldata currency_, uint8 decimals_, address owner_) external {
        require(!_initialized, "phw: already initialized");
        _initialized = true;
        name = name_;
        symbol = symbol_;
        currency = currency_;
        decimals = decimals_;
        owner = owner_;
        masterMinter = owner_;
        pauser = owner_;
        blacklister = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    /// @notice 지금 프록시가 실행 중인 구현의 판 번호
    function implementationVersion() public pure virtual returns (string memory) {
        return "1";
    }

    /// @notice 서명(EIP-712)의 '도메인': 어떤 체인의 어떤 토큰 앞으로 한 서명인지 묶어서, 다른 곳에서 재사용 못 하게 한다
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes(name)), keccak256(bytes("1")), block.chainid, address(this)
        ));
    }

    // ───── ERC-20 ─────
    function transfer(address to, uint256 value) external whenNotPaused notBlacklisted(msg.sender) notBlacklisted(to) returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    /// @notice 메모를 붙인 송금 (실제 USDC 에는 없는 이 거래소의 확장 기능)
    function transferWithMemo(address to, uint256 value, string calldata memo)
        external whenNotPaused notBlacklisted(msg.sender) notBlacklisted(to) returns (bool)
    {
        require(bytes(memo).length <= 200, "phw: memo too long");
        _transfer(msg.sender, to, value);
        emit Memo(msg.sender, to, value, memo);
        return true;
    }

    function approve(address spender, uint256 value) external whenNotPaused notBlacklisted(msg.sender) notBlacklisted(spender) returns (bool) {
        _approve(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value)
        external whenNotPaused notBlacklisted(msg.sender) notBlacklisted(from) notBlacklisted(to) returns (bool)
    {
        uint256 a = allowance[from][msg.sender];
        require(a >= value, "phw: transfer amount exceeds allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "phw: transfer to the zero address");
        require(balanceOf[from] >= value, "phw: transfer amount exceeds balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _approve(address o, address spender, uint256 value) internal {
        allowance[o][spender] = value;
        emit Approval(o, spender, value);
    }

    // ───── 발행 · 소각 ─────
    /// @notice 발행 담당자가 '은행 입금을 확인했다'고 보고 발행한다. 발행 한도가 그만큼 줄어든다.
    function mint(address to, uint256 amount, string calldata memo)
        external whenNotPaused onlyMinters notBlacklisted(msg.sender) notBlacklisted(to) returns (bool)
    {
        require(to != address(0), "phw: mint to the zero address");
        require(amount > 0, "phw: mint amount not greater than 0");
        uint256 allowed = minterAllowance[msg.sender];
        require(amount <= allowed, "phw: mint amount exceeds minterAllowance");
        minterAllowance[msg.sender] = allowed - amount;
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Mint(msg.sender, to, amount, memo);
        emit Transfer(address(0), to, amount);
        return true;
    }

    /// @notice 상환 처리: 이용자가 발행 담당자에게 보낸 코인을 발행 담당자가 자기 잔액에서 소각한다.
    function burn(uint256 amount, string calldata memo) external whenNotPaused onlyMinters notBlacklisted(msg.sender) {
        require(amount > 0, "phw: burn amount not greater than 0");
        require(balanceOf[msg.sender] >= amount, "phw: burn amount exceeds balance");
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        emit Burn(msg.sender, amount, memo);
        emit Transfer(msg.sender, address(0), amount);
    }

    function configureMinter(address minter, uint256 minterAllowedAmount) external whenNotPaused onlyMasterMinter returns (bool) {
        isMinter[minter] = true;
        minterAllowance[minter] = minterAllowedAmount;
        emit MinterConfigured(minter, minterAllowedAmount);
        return true;
    }

    function removeMinter(address minter) external onlyMasterMinter returns (bool) {
        isMinter[minter] = false;
        minterAllowance[minter] = 0;
        emit MinterRemoved(minter);
        return true;
    }

    // ───── 블랙리스트 · 일시정지 ─────
    function blacklist(address account, string calldata reason) external onlyBlacklister {
        isBlacklisted[account] = true;
        emit Blacklisted(account, reason);
    }

    function unBlacklist(address account, string calldata reason) external onlyBlacklister {
        isBlacklisted[account] = false;
        emit UnBlacklisted(account, reason);
    }

    /// @notice (USDT 방식) 블랙리스트에 오른 계좌의 잔액을 소각한다. 법원 명령·범죄 수익 등.
    function destroyBlackFunds(address account, string calldata reason) external onlyBlacklister {
        require(isBlacklisted[account], "phw: account is not blacklisted");
        uint256 amount = balanceOf[account];
        balanceOf[account] = 0;
        totalSupply -= amount;
        emit BlackFundsDestroyed(account, amount, reason);
        emit Transfer(account, address(0), amount);
    }

    function pause(string calldata reason) external onlyPauser {
        paused = true;
        emit Pause(reason);
    }

    function unpause(string calldata reason) external onlyPauser {
        paused = false;
        emit Unpause(reason);
    }

    // ───── 준비금 공시 (실제로는 회계법인이 매달 블록체인 밖에서 보고서로 낸다) ─────
    function attestReserve(uint256 reserve, string calldata evidence) external onlyMasterMinter {
        attestations.push(Attestation(reserve, totalSupply, uint64(block.timestamp), evidence));
        emit ReserveAttested(attestations.length - 1, reserve, totalSupply, evidence);
    }

    function attestationCount() external view returns (uint256) {
        return attestations.length;
    }

    // ───── 역할 관리 ─────
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "phw: new owner is the zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function updateMasterMinter(address a) external onlyOwner { masterMinter = a; emit MasterMinterChanged(a); }
    function updatePauser(address a) external onlyOwner { pauser = a; emit PauserChanged(a); }
    function updateBlacklister(address a) external onlyOwner { blacklister = a; emit BlacklisterChanged(a); }

    // ───── EIP-2612: 서명으로 결제 허용 ─────
    function permit(address owner_, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external whenNotPaused notBlacklisted(owner_) notBlacklisted(spender)
    {
        require(deadline >= block.timestamp, "phw: permit is expired");
        bytes32 digest = _digest(keccak256(abi.encode(PERMIT_TYPEHASH, owner_, spender, value, nonces[owner_]++, deadline)));
        require(_recover(digest, v, r, s) == owner_, "phw: invalid signature");
        _approve(owner_, spender, value);
    }

    // ───── EIP-3009: 서명으로 송금 · 결제 ─────
    function transferWithAuthorization(
        address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s
    ) external whenNotPaused notBlacklisted(from) notBlacklisted(to) {
        _useAuthorization(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, v, r, s);
        _transfer(from, to, value);
    }

    /// @notice 받는 쪽(to)만 실행할 수 있는 송금 서명. 상점가 같은 컨트랙트가 '결제 받기'에 쓴다.
    function receiveWithAuthorization(
        address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s
    ) external whenNotPaused notBlacklisted(from) notBlacklisted(to) {
        require(to == msg.sender, "phw: caller must be the payee");
        _useAuthorization(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, v, r, s);
        _transfer(from, to, value);
    }

    function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external whenNotPaused {
        require(!authorizationState[authorizer][nonce], "phw: authorization is used or canceled");
        bytes32 digest = _digest(keccak256(abi.encode(CANCEL_AUTHORIZATION_TYPEHASH, authorizer, nonce)));
        require(_recover(digest, v, r, s) == authorizer, "phw: invalid signature");
        authorizationState[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    function _useAuthorization(
        bytes32 typehash, address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s
    ) private {
        require(block.timestamp > validAfter, "phw: authorization is not yet valid");
        require(block.timestamp < validBefore, "phw: authorization is expired");
        require(!authorizationState[from][nonce], "phw: authorization is used or canceled");
        bytes32 digest = _digest(keccak256(abi.encode(typehash, from, to, value, validAfter, validBefore, nonce)));
        require(_recover(digest, v, r, s) == from, "phw: invalid signature");
        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
    }

    function _digest(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    function _recover(bytes32 digest, uint8 v, bytes32 r, bytes32 s) private pure returns (address signer) {
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "phw: invalid signature 's' value");
        signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "phw: invalid signature");
    }
}

/// @title SeogilwonV2 - 박형원 구현 2판 (업그레이드 체험용)
/// @notice 업그레이드하면 같은 주소·같은 잔액 위에서 아래 '새 권한'이 생긴다.
///         감독 관점: 이용자는 아무것도 바꾸지 않았는데, 발행사가 규칙을 바꿀 수 있다는 것이 업그레이드 가능 토큰의 핵심 위험이다.
contract SeogilwonV2 is SeogilwonV1 {
    event Clawback(address indexed by, address indexed from, uint256 amount, string reason);

    function implementationVersion() public pure override returns (string memory) {
        return "2";
    }

    /// @notice 블랙리스트 절차 없이, 소유자가 아무 계좌에서나 코인을 바로 회수해 자기 계좌로 옮긴다.
    function clawback(address from, uint256 amount, string calldata reason) external onlyOwner {
        require(balanceOf[from] >= amount, "phw: clawback amount exceeds balance");
        balanceOf[from] -= amount;
        balanceOf[owner] += amount;
        emit Transfer(from, owner, amount);
        emit Clawback(msg.sender, from, amount, reason);
    }
}
