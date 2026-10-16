// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FriendCoin - 참여자 누구나 만드는 '내 코인' (ERC-20, 소수점 0)
/// @notice 만든 사람(발행자)만 추가 발행할 수 있고, 보유자는 자기 코인을 소각할 수 있다.
///         준비자산·충전 승인·동결 같은 통제 장치가 없다는 점이 공식 원화코인(WonCoin)과 다르다.
contract FriendCoin {
    string public name;
    string public symbol;
    uint8 public constant decimals = 0;
    uint256 public totalSupply;
    address public issuer;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Memo(address indexed from, address indexed to, uint256 value, string memo);
    event Minted(address indexed to, uint256 amount, string memo);

    constructor(string memory name_, string memory symbol_, address issuer_, uint256 initialSupply) {
        name = name_;
        symbol = symbol_;
        issuer = issuer_;
        if (initialSupply > 0) _mint(issuer_, initialSupply, "initial");
    }

    function mint(address to, uint256 amount, string calldata memo) external {
        require(msg.sender == issuer, "FriendCoin: issuer only");
        _mint(to, amount, memo);
    }

    function burn(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "FriendCoin: balance too low");
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferWithMemo(address to, uint256 value, string calldata memo) external returns (bool) {
        require(bytes(memo).length <= 200, "FriendCoin: memo too long");
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
        require(a >= value, "FriendCoin: allowance too low");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        require(to != address(0), "FriendCoin: to zero address");
        require(balanceOf[from] >= value, "FriendCoin: balance too low");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 amount, string memory memo) private {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
        emit Minted(to, amount, memo);
    }
}

/// @title CoinFactory - 버튼 하나로 '내 코인'을 만드는 공장
/// @notice 컨트랙트가 다른 컨트랙트를 만드는(CREATE) 모습을 보여준다.
///         감독 관점: 신원 확인 없이, 몇 초 만에, 아무 이름으로나 코인이 생긴다.
contract CoinFactory {
    address[] private _coins;

    event CoinCreated(address indexed coin, address indexed issuer, string name, string symbol, uint256 initialSupply);

    function createCoin(string calldata name_, string calldata symbol_, uint256 initialSupply) external returns (address coin) {
        require(bytes(name_).length >= 1 && bytes(name_).length <= 40, "Factory: name 1-40 bytes");
        require(bytes(symbol_).length >= 1 && bytes(symbol_).length <= 11, "Factory: symbol 1-11 bytes");
        coin = address(new FriendCoin(name_, symbol_, msg.sender, initialSupply));
        _coins.push(coin);
        emit CoinCreated(coin, msg.sender, name_, symbol_, initialSupply);
    }

    function coinCount() external view returns (uint256) {
        return _coins.length;
    }

    function allCoins() external view returns (address[] memory) {
        return _coins;
    }
}
