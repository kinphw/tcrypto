// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Forwarder - 수수료 대납 중계 (ERC-2771 표준의 단순판)
/// @notice 이용자는 "이 프로그램의 이 함수를 내 이름으로 실행해 달라"는 요청에 서명만 한다(수수료 0).
///         대납자(relayer)가 그 서명을 execute 로 올리면서 수수료를 낸다.
///         중계기는 서명을 검증한 뒤, 요청 끝에 '진짜 요청자 주소'를 붙여 대상 프로그램을 호출한다.
///         대상 프로그램(명부·상점가·코인공장)은 이 중계기를 믿고 끝의 20바이트를 실제 호출자로 본다.
///         대납자는 내용을 바꿀 수 없다(서명이 깨짐). 할 수 있는 것은 '안 올려주기'뿐이다.
contract Forwarder {
    struct ForwardRequest {
        address from;
        address to;
        uint256 value;
        uint256 gas;
        uint256 nonce;
        uint256 deadline;
        bytes data;
    }

    bytes32 public constant REQUEST_TYPEHASH =
        keccak256("ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint256 deadline,bytes data)");
    mapping(address => uint256) public nonces;

    event Executed(address indexed from, address indexed to, address indexed relayer, uint256 nonce);

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes(unicode"청라더헤븐 대납 중계")), keccak256(bytes("1")), block.chainid, address(this)
        ));
    }

    function verify(ForwardRequest calldata req, bytes calldata signature) public view returns (bool) {
        if (nonces[req.from] != req.nonce || block.timestamp > req.deadline) return false;
        return _signer(req, signature) == req.from;
    }

    function execute(ForwardRequest calldata req, bytes calldata signature) external payable returns (bytes memory) {
        require(block.timestamp <= req.deadline, "forwarder: request expired");
        require(nonces[req.from] == req.nonce, "forwarder: nonce mismatch");
        require(_signer(req, signature) == req.from, "forwarder: signature does not match request");
        require(msg.value == req.value, "forwarder: value mismatch");
        nonces[req.from] = req.nonce + 1;

        (bool ok, bytes memory ret) = req.to.call{gas: req.gas, value: req.value}(abi.encodePacked(req.data, req.from));
        if (!ok) assembly { revert(add(ret, 32), mload(ret)) } // 대상 프로그램의 거절 사유를 그대로 전달
        // 대납자가 가스를 일부러 적게 줘서 실패시키는 것을 막는 검사 (EIP-150 의 63/64 규칙)
        if (gasleft() <= req.gas / 63) assembly { invalid() }
        emit Executed(req.from, req.to, msg.sender, req.nonce);
        return ret;
    }

    function _signer(ForwardRequest calldata req, bytes calldata signature) private view returns (address) {
        require(signature.length == 65, "forwarder: bad signature length");
        bytes32 structHash = keccak256(abi.encode(REQUEST_TYPEHASH, req.from, req.to, req.value, req.gas, req.nonce, req.deadline, keccak256(req.data)));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (v < 27) v += 27;
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "forwarder: bad 's' value");
        return ecrecover(digest, v, r, s);
    }
}

/// @title ERC2771Context - 중계기를 통해 들어온 호출이면 '진짜 요청자'를 꺼내 쓰는 공통 부품
abstract contract ERC2771Context {
    address public immutable trustedForwarder;

    constructor(address forwarder_) {
        trustedForwarder = forwarder_;
    }

    function _msgSender() internal view returns (address sender) {
        if (msg.sender == trustedForwarder && msg.data.length >= 20) {
            assembly { sender := shr(96, calldataload(sub(calldatasize(), 20))) }
        } else {
            sender = msg.sender;
        }
    }
}
