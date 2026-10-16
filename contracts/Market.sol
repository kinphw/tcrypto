// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IWonCoin {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title Market - 가상 상점가
/// @notice 누구나 상점을 열고 상품을 올릴 수 있다. 구매하면 원화코인이 구매자에게서 상점 주인에게 곧바로 이전된다.
/// @dev    결제 흐름(ERC-20 표준 방식):
///         1) 구매자가 원화코인 컨트랙트에 "상점가가 내 코인을 N원까지 꺼내 가도 된다"고 허락(approve)
///         2) buy() 가 재고를 줄이고, 원화코인의 transferFrom 으로 구매자 → 상점 주인 이전
///         두 단계가 한 거래(buy) 안에서 함께 성공하거나 함께 실패한다(원자성). 돈만 빠지고 물건이 안 오는 일은 없다.
///         상품 사진은 저장소가 아니라 이벤트 로그에 담는다(훨씬 싸다). 저장소에는 사진의 지문(해시)만 남긴다.
contract Market {
    IWonCoin public immutable coin;
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
        uint256 price;    // 원
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

    constructor(address coin_) {
        coin = IWonCoin(coin_);
    }

    function openShop(string calldata name, string calldata description) external returns (uint256 shopId) {
        require(bytes(name).length >= 1 && bytes(name).length <= 60, "Market: shop name 1-60 bytes");
        require(bytes(description).length <= 300, "Market: description too long");
        _shops.push(Shop(msg.sender, true, uint64(block.timestamp), name, description));
        shopId = _shops.length;
        emit ShopOpened(shopId, msg.sender, name, description);
    }

    function setShopOpen(uint256 shopId, bool open_) external {
        Shop storage s = _shop(shopId);
        require(s.owner == msg.sender, "Market: not your shop");
        s.open = open_;
        emit ShopStatus(shopId, open_);
    }

    function listProduct(
        uint256 shopId,
        string calldata name,
        string calldata description,
        uint256 price,
        uint256 stock,
        string calldata mime,
        bytes calldata image
    ) external returns (uint256 productId) {
        require(_shop(shopId).owner == msg.sender, "Market: not your shop");
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
        require(_shops[p.shopId - 1].owner == msg.sender, "Market: not your shop");
        require(price > 0, "Market: price must be > 0");
        p.price = price;
        p.stock = stock;
        p.active = active;
        emit ProductUpdated(productId, price, stock, active);
    }

    function buy(uint256 productId, uint256 quantity, string calldata note) external returns (uint256 orderId) {
        Product storage p = _product(productId);
        Shop storage s = _shops[p.shopId - 1];
        require(s.open, "Market: shop closed");
        require(p.active, "Market: product not on sale");
        require(quantity > 0 && quantity <= p.stock, "Market: not enough stock");
        require(s.owner != msg.sender, "Market: cannot buy from your own shop");
        require(bytes(note).length <= 200, "Market: note too long");
        uint256 total = p.price * quantity;
        p.stock -= quantity;
        p.sold += quantity;
        orderId = ++orderCount;
        require(coin.transferFrom(msg.sender, s.owner, total), "Market: payment failed");
        emit Purchased(orderId, productId, p.shopId, msg.sender, s.owner, quantity, total, note);
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
