// 로컬 시험망 전용 (npx hardhat node → http://127.0.0.1:8545). 컴파일은 tools-js/compile.mjs 가 한다.
module.exports = { solidity: '0.8.30', networks: { hardhat: { hardfork: 'cancun', chainId: 31337 } } };
