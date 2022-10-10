import JSBI from 'jsbi'

export enum TradeState {
  SELL_ALL,
  SELL_TOKEN_0,
  SELL_TOKEN_1,
  SELL_NONE
}

export const FACTORY_ADDRESS = '0x4233ad9b8b7c1ccf0818907908a7f0796a3df85f'

export const INIT_CODE_HASH = '0xfc84b622ba228c468b74c2d99bfe9454ffac280ac017f05a02feb9f739aeb1e4'

export const MINIMUM_LIQUIDITY = JSBI.BigInt(1000)

// exports for internal consumption
export const ZERO = JSBI.BigInt(0)
export const ONE = JSBI.BigInt(1)
export const TWO = JSBI.BigInt(2)
export const THREE = JSBI.BigInt(3)
export const FIVE = JSBI.BigInt(5)
export const EIGHT = JSBI.BigInt(8)
export const TEN = JSBI.BigInt(10)
export const _100 = JSBI.BigInt(100)
export const _998 = JSBI.BigInt(998)
export const _1000 = JSBI.BigInt(1000)
export const _10000 = JSBI.BigInt(10000)

export enum SolidityType {
  uint8 = 'uint8',
  uint256 = 'uint256'
}

export const SOLIDITY_TYPE_MAXIMA = {
  [SolidityType.uint8]: JSBI.BigInt('0xff'),
  [SolidityType.uint256]: JSBI.BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
}
