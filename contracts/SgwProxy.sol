// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SgwProxy - 서길원의 '고정 주소' (업그레이드 가능 프록시, EIP-1967)
/// @notice 이용자·지갑·이더스캔은 이 주소를 서길원으로 안다. 이 컨트랙트는 거의 아무 기능도 없고,
///         들어온 호출을 '구현' 컨트랙트의 코드로 실행(delegatecall)하되 데이터는 자기 저장공간에 둔다.
///         관리자(admin)가 upgradeTo 로 구현 주소를 바꾸면, 주소와 잔액은 그대로인 채 규칙이 바뀐다.
///         구현 주소·관리자 주소는 EIP-1967 이 정한 고정 칸에 저장되어, 이더스캔 등이 자동으로 알아본다.
contract SgwProxy {
    // keccak256("eip1967.proxy.implementation") - 1
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    // keccak256("eip1967.proxy.admin") - 1
    bytes32 private constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    event Upgraded(address indexed implementation);
    event AdminChanged(address previousAdmin, address newAdmin);

    constructor(address implementation_, address admin_, bytes memory initData) {
        _setImplementation(implementation_);
        _setAdmin(admin_);
        emit AdminChanged(address(0), admin_);
        if (initData.length > 0) {
            (bool ok, bytes memory ret) = implementation_.delegatecall(initData);
            if (!ok) assembly { revert(add(ret, 32), mload(ret)) }
        }
    }

    function proxyAdmin() external view returns (address a) { assembly { a := sload(ADMIN_SLOT) } }
    function proxyImplementation() external view returns (address i) { assembly { i := sload(IMPLEMENTATION_SLOT) } }

    /// @notice 관리자만: 서길원의 규칙(구현)을 새 코드로 교체
    function upgradeTo(address newImplementation) external {
        require(msg.sender == _admin(), "proxy: caller is not the admin");
        _setImplementation(newImplementation);
    }

    function changeProxyAdmin(address newAdmin) external {
        require(msg.sender == _admin(), "proxy: caller is not the admin");
        require(newAdmin != address(0), "proxy: new admin is the zero address");
        emit AdminChanged(_admin(), newAdmin);
        _setAdmin(newAdmin);
    }

    function _admin() private view returns (address a) { assembly { a := sload(ADMIN_SLOT) } }

    function _setAdmin(address a) private { assembly { sstore(ADMIN_SLOT, a) } }

    function _setImplementation(address i) private {
        require(i.code.length > 0, "proxy: implementation is not a contract");
        assembly { sstore(IMPLEMENTATION_SLOT, i) }
        emit Upgraded(i);
    }

    fallback() external payable {
        assembly {
            let impl := sload(IMPLEMENTATION_SLOT)
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {
        revert("proxy: does not accept ETH");
    }
}
