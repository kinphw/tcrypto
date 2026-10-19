// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Forwarder.sol";

interface ISgw {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function receiveWithAuthorization(
        address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s
    ) external;
}

/// @title Market - 청라더헤븐 상점가
/// @notice 누구나 상점을 열고 상품을 올린다. 구매하면 서길원(sgw)이 구매자에게서 상점 주인에게 옮겨진다.
///   결제 방법 두 가지
///   1) buy                  : (ERC-20 표준) 미리 '결제 허용(approve)' 한 뒤 구매. 구매자가 ETH 수수료를 낸다.
///   2) buyWithAuthorization : (USDC 의 EIP-3009) 구매자는 "상점가가 내 서길원 N 을 받아 가도 된다"에 서명만 하고,
///                             누구든 대신 올리며 수수료를 낸다. 결제와 재고 감소가 한 거래 안에서 함께 성공하거나 함께 실패한다.
///   상점 열기·상품 올리기 등은 대납 중계(Forwarder)를 통하면 서명만으로 할 수 있다.
///   상품 사진은 저장소가 아니라 이벤트 로그에 담는다(훨씬 싸다). 저장소에는 사진의 지문(해시)만 남긴다.
contract Market is ERC2771Context {
    ISgw public immutable coin;
    uint256 public constant MAX_IMAGE = 24_000; // bytes

    struct Shop {
        address owner;
        bool open;
        uint64 openedAt;
        string name;
        string description;
    }

    struct Product {
        uint256 shopId;
        uint256 price;
        uint256 stock;
        uint256 sold;
        bool active;
        string name;
        bytes32 imageHash;
    }

    Shop[] private _shops;       // id = 인덱스 + 1
    Product[] private _products; // id = 인덱스 + 1
    uint256 public orderCount;

    event ShopOpened(uint256 indexed shopId, address indexed owner, string name, string description);
    event ShopStatus(uint256 indexed shopId, bool open);
    event ProductListed(uint256 indexed productId, uint256 indexed shopId, string name, string description, uint256 price, uint256 stock, string mime, bytes image);
    event ProductUpdated(uint256 indexed productId, uint256 price, uint256 stock, bool active);
    event Purchased(uint256 indexed orderId, uint256 indexed productId, uint256 indexed shopId, address buyer, address seller, uint256 quantity, uint256 total, string note);

    constructor(address coin_, address forwarder_) ERC2771Context(forwarder_) {
        coin = ISgw(coin_);
    }

    function openShop(string calldata name, string calldata description) external returns (uint256 shopId) {
        require(bytes(name).length >= 1 && bytes(name).length <= 60, "Market: shop name 1-60 bytes");
        require(bytes(description).length <= 300, "Market: description too long");
        _shops.push(Shop(_msgSender(), true, uint64(block.timestamp), name, description));
        shopId = _shops.length;
        emit ShopOpened(shopId, _msgSender(), name, description);
    }

    function setShopOpen(uint256 shopId, bool open_) external {
        Shop storage s = _shop(shopId);
        require(s.owner == _msgSender(), "Market: not your shop");
        s.open = open_;
        emit ShopStatus(shopId, open_);
    }

    function listProduct(
        uint256 shopId, string calldata name, string calldata description, uint256 price, uint256 stock, string calldata mime, bytes calldata image
    ) external returns (uint256 productId) {
        require(_shop(shopId).owner == _msgSender(), "Market: not your shop");
        require(bytes(name).length >= 1 && bytes(name).length <= 80, "Market: product name 1-80 bytes");
        require(bytes(description).length <= 500, "Market: description too long");
        require(price > 0, "Market: price must be > 0");
        require(image.length <= MAX_IMAGE, "Market: image too big");
        _products.push(Product(shopId, price, stock, 0, true, name, keccak256(image)));
        productId = _products.length;
        emit ProductListed(productId, shopId, name, description, price, stock, mime, image);
    }

    function updateProduct(uint256 productId, uint256 price, uint256 stock, bool active) external {
        Product storage p = _product(productId);
        require(_shops[p.shopId - 1].owner == _msgSender(), "Market: not your shop");
        require(price > 0, "Market: price must be > 0");
        p.price = price;
        p.stock = stock;
        p.active = active;
        emit ProductUpdated(productId, price, stock, active);
    }

    /// @notice 결제 방법 1: 미리 approve 해 둔 서길원으로 구매 (구매자가 수수료를 냄)
    function buy(uint256 productId, uint256 quantity, string calldata note) external returns (uint256 orderId) {
        address buyer = _msgSender();
        (uint256 total, address seller, uint256 shopId) = _take(productId, quantity, buyer, note);
        require(coin.transferFrom(buyer, seller, total), "Market: payment failed");
        orderId = orderCount;
        emit Purchased(orderId, productId, shopId, buyer, seller, quantity, total, note);
    }

    /// @notice 결제 방법 2: 구매자의 EIP-3009 결제 서명으로 구매 (누구든 대신 올리며 수수료를 냄)
    /// @dev    서명 내용은 "from=구매자, to=상점가, value=총액" 이어야 한다. 상점가가 받은 뒤 바로 상점 주인에게 넘긴다.
    function buyWithAuthorization(
        uint256 productId, uint256 quantity, string calldata note,
        address buyer, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s
    ) external returns (uint256 orderId) {
        (uint256 total, address seller, uint256 shopId) = _take(productId, quantity, buyer, note);
        coin.receiveWithAuthorization(buyer, address(this), total, validAfter, validBefore, nonce, v, r, s);
        require(coin.transfer(seller, total), "Market: payout failed");
        orderId = orderCount;
        emit Purchased(orderId, productId, shopId, buyer, seller, quantity, total, note);
    }

    function _take(uint256 productId, uint256 quantity, address buyer, string calldata note)
        private returns (uint256 total, address seller, uint256 shopId)
    {
        Product storage p = _product(productId);
        Shop storage s = _shops[p.shopId - 1];
        require(s.open, "Market: shop closed");
        require(p.active, "Market: product not on sale");
        require(quantity > 0 && quantity <= p.stock, "Market: not enough stock");
        require(s.owner != buyer, "Market: cannot buy from your own shop");
        require(bytes(note).length <= 200, "Market: note too long");
        total = p.price * quantity;
        p.stock -= quantity;
        p.sold += quantity;
        orderCount++;
        return (total, s.owner, p.shopId);
    }

    function shopCount() external view returns (uint256) { return _shops.length; }
    function productCount() external view returns (uint256) { return _products.length; }
    function getShop(uint256 shopId) external view returns (Shop memory) { return _shop(shopId); }
    function getProduct(uint256 productId) external view returns (Product memory) { return _product(productId); }

    function _shop(uint256 id) private view returns (Shop storage) {
        require(id >= 1 && id <= _shops.length, "Market: no such shop");
        return _shops[id - 1];
    }

    function _product(uint256 id) private view returns (Product storage) {
        require(id >= 1 && id <= _products.length, "Market: no such product");
        return _products[id - 1];
    }
}
