// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Forwarder.sol";

/// @title FriendCoin - 참여자 누구나 만드는 '내 코인' (ERC-20, 소수점 0)
/// @notice 만든 사람(발행자)만 추가 발행할 수 있고, 보유자는 자기 코인을 소각할 수 있다.
///         준비자산·발행 한도·블랙리스트·업그레이드 같은 장치가 없다는 점이 서길원과 다르다.
///         대납 중계(Forwarder)를 통하면 서명만으로 보내고 발행할 수 있다.
contract FriendCoin is ERC2771Context {
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

    constructor(string memory name_, string memory symbol_, address issuer_, uint256 initialSupply, address forwarder_)
        ERC2771Context(forwarder_)
    {
        name = name_;
        symbol = symbol_;
        issuer = issuer_;
        if (initialSupply > 0) _mint(issuer_, initialSupply, "initial");
    }

    function mint(address to, uint256 amount, string calldata memo) external {
        require(_msgSender() == issuer, "FriendCoin: issuer only");
        _mint(to, amount, memo);
    }

    function burn(uint256 amount) external {
        address who = _msgSender();
        require(balanceOf[who] >= amount, "FriendCoin: balance too low");
        balanceOf[who] -= amount;
        totalSupply -= amount;
        emit Transfer(who, address(0), amount);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(_msgSender(), to, value);
        return true;
    }

    function transferWithMemo(address to, uint256 value, string calldata memo) external returns (bool) {
        require(bytes(memo).length <= 200, "FriendCoin: memo too long");
        _transfer(_msgSender(), to, value);
        emit Memo(_msgSender(), to, value, memo);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[_msgSender()][spender] = value;
        emit Approval(_msgSender(), spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        address spender = _msgSender();
        uint256 a = allowance[from][spender];
        require(a >= value, "FriendCoin: allowance too low");
        if (a != type(uint256).max) allowance[from][spender] = a - value;
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
/// @notice 컨트랙트가 다른 컨트랙트를 만드는(CREATE) 모습을 보여준다. 대납 중계로 서명만으로도 만들 수 있다.
///         감독 관점: 신원 확인 없이, 몇 초 만에, 아무 이름으로나 코인이 생긴다.
contract CoinFactory is ERC2771Context {
    address[] private _coins;

    event CoinCreated(address indexed coin, address indexed issuer, string name, string symbol, uint256 initialSupply);

    constructor(address forwarder_) ERC2771Context(forwarder_) {}

    function createCoin(string calldata name_, string calldata symbol_, uint256 initialSupply) external returns (address coin) {
        require(bytes(name_).length >= 1 && bytes(name_).length <= 40, "Factory: name 1-40 bytes");
        require(bytes(symbol_).length >= 1 && bytes(symbol_).length <= 11, "Factory: symbol 1-11 bytes");
        address who = _msgSender();
        coin = address(new FriendCoin(name_, symbol_, who, initialSupply, trustedForwarder));
        _coins.push(coin);
        emit CoinCreated(coin, who, name_, symbol_, initialSupply);
    }

    function coinCount() external view returns (uint256) {
        return _coins.length;
    }

    function allCoins() external view returns (address[] memory) {
        return _coins;
    }
}
