// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Forwarder.sol";

interface ISgwCoupons {
    function transfer(address to, uint256 value) external returns (bool);
    function receiveWithAuthorization(
        address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s
    ) external;
}

/// @title Coupons - 수원더헤븐 쿠폰 시장
/// @notice 누구나 "밥 한 끼 사주기권" 같은 쿠폰을 정해진 장수만큼 만든다. 만든 사람이 처음에 전부 갖고,
///   박형원(sgw)을 받고 팔거나(buyWithAuthorization) 그냥 선물한다(gift). 받은 사람은 선물을 이어서 넘길 수도 있다.
///   쿠폰을 쓰면(redeem) 그 장수만큼 사라지고, 만든 사람에게 '사용됨' 기록(이벤트)이 남는다 → 만든 사람이 약속을 지킨다.
///   쿠폰 사진은 상점가처럼 이벤트 로그에 담고 저장소에는 지문(해시)만 남긴다.
contract Coupons is ERC2771Context {
    ISgwCoupons public immutable coin;
    uint256 public constant MAX_IMAGE = 24_000; // bytes

    struct Coupon {
        address creator;
        uint64 createdAt;
        bool onSale;
        uint256 price;
        uint256 supply;
        uint256 sold;
        uint256 redeemed;
        string name;
        bytes32 imageHash;
    }

    Coupon[] private _coupons; // id = 인덱스 + 1
    mapping(uint256 => mapping(address => uint256)) public balanceOf;

    event Created(uint256 indexed id, address indexed creator, string name, string description, uint256 price, uint256 supply, string mime, bytes image);
    event SaleChanged(uint256 indexed id, uint256 price, bool onSale);
    event Bought(uint256 indexed id, address indexed buyer, address indexed creator, uint256 amount, uint256 total);
    event Gifted(uint256 indexed id, address indexed from, address indexed to, uint256 amount, string message);
    event Redeemed(uint256 indexed id, address indexed holder, address indexed creator, uint256 amount, string note);

    constructor(address coin_, address forwarder_) ERC2771Context(forwarder_) {
        coin = ISgwCoupons(coin_);
    }

    function create(
        string calldata name, string calldata description, string calldata mime, bytes calldata image, uint256 supply, uint256 price
    ) external returns (uint256 id) {
        require(bytes(name).length >= 1 && bytes(name).length <= 60, "Coupons: name 1-60 bytes");
        require(bytes(description).length <= 300, "Coupons: description too long");
        require(image.length <= MAX_IMAGE, "Coupons: image too large");
        require(supply >= 1 && supply <= 1000, "Coupons: supply 1-1000");
        address creator = _msgSender();
        _coupons.push(Coupon({
            creator: creator, createdAt: uint64(block.timestamp), onSale: price > 0, price: price,
            supply: supply, sold: 0, redeemed: 0, name: name, imageHash: keccak256(image)
        }));
        id = _coupons.length;
        balanceOf[id][creator] = supply;
        emit Created(id, creator, name, description, price, supply, mime, image);
    }

    /// @notice 만든 사람이 가격을 바꾸거나 판매를 멈춘다 (price 0 = 판매 안 함, 선물만)
    function setSale(uint256 id, uint256 price, bool onSale_) external {
        Coupon storage c = _coupon(id);
        require(_msgSender() == c.creator, "Coupons: creator only");
        require(!onSale_ || price > 0, "Coupons: price must be > 0 to sell");
        c.price = price;
        c.onSale = onSale_;
        emit SaleChanged(id, price, onSale_);
    }

    /// @notice 서명 결제로 사기. 서명 내용은 "from=구매자, to=쿠폰 시장, value=가격×장수" 이어야 한다.
    function buyWithAuthorization(
        uint256 id, uint256 amount,
        address buyer, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s
    ) external {
        Coupon storage c = _coupon(id);
        require(c.onSale, "Coupons: not on sale");
        require(amount > 0 && balanceOf[id][c.creator] >= amount, "Coupons: sold out");
        require(buyer != c.creator, "Coupons: cannot buy your own coupon");
        uint256 total = c.price * amount;
        balanceOf[id][c.creator] -= amount;
        balanceOf[id][buyer] += amount;
        c.sold += amount;
        coin.receiveWithAuthorization(buyer, address(this), total, validAfter, validBefore, nonce, v, r, s);
        require(coin.transfer(c.creator, total), "Coupons: payout failed");
        emit Bought(id, buyer, c.creator, amount, total);
    }

    function gift(address to, uint256 id, uint256 amount, string calldata message) external {
        _coupon(id);
        address from = _msgSender();
        require(to != address(0) && to != from, "Coupons: bad recipient");
        require(amount > 0 && balanceOf[id][from] >= amount, "Coupons: not enough coupons");
        require(bytes(message).length <= 200, "Coupons: message too long");
        balanceOf[id][from] -= amount;
        balanceOf[id][to] += amount;
        emit Gifted(id, from, to, amount, message);
    }

    /// @notice 쿠폰 쓰기: 장수만큼 사라지고 만든 사람에게 '사용됨' 기록이 남는다
    function redeem(uint256 id, uint256 amount, string calldata note) external {
        Coupon storage c = _coupon(id);
        address holder = _msgSender();
        require(amount > 0 && balanceOf[id][holder] >= amount, "Coupons: not enough coupons");
        require(bytes(note).length <= 200, "Coupons: note too long");
        balanceOf[id][holder] -= amount;
        c.redeemed += amount;
        emit Redeemed(id, holder, c.creator, amount, note);
    }

    function couponCount() external view returns (uint256) { return _coupons.length; }
    function getCoupon(uint256 id) external view returns (Coupon memory) { return _coupon(id); }

    function _coupon(uint256 id) private view returns (Coupon storage) {
        require(id >= 1 && id <= _coupons.length, "Coupons: no such coupon");
        return _coupons[id - 1];
    }
}
