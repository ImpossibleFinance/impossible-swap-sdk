import { CurrencyAmount, Ether, SupportedChainId, Token, WETH9 } from '@uniswap/sdk-core'
import { Pair, Route, TradeState } from '../src'

const BasicPair = (a: CurrencyAmount<Token>, b: CurrencyAmount<Token>): Pair => {
  return new Pair(a, b, false, 30, 1, 1, TradeState.SELL_ALL)
}

describe('Route', () => {
  const token0 = new Token(SupportedChainId.MAINNET, '0x0000000000000000000000000000000000000001', 18, 't0')
  const token1 = new Token(SupportedChainId.MAINNET, '0x0000000000000000000000000000000000000002', 18, 't1')
  const weth = WETH9[SupportedChainId.MAINNET]
  const ETHER = Ether.onChain(SupportedChainId.MAINNET)

  const pair_0_1 = BasicPair(CurrencyAmount.fromRawAmount(token0, '100'), CurrencyAmount.fromRawAmount(token1, '200'))
  const pair_0_weth = BasicPair(CurrencyAmount.fromRawAmount(token0, '100'), CurrencyAmount.fromRawAmount(weth, '100'))
  const pair_1_weth = BasicPair(CurrencyAmount.fromRawAmount(token1, '175'), CurrencyAmount.fromRawAmount(weth, '100'))

  it('constructs a path from the tokens', () => {
    const route = new Route([pair_0_1], token0, token1)
    expect(route.pairs).toEqual([pair_0_1])
    expect(route.path).toEqual([token0, token1])
    expect(route.input).toEqual(token0)
    expect(route.output).toEqual(token1)
    expect(route.chainId).toEqual(SupportedChainId.MAINNET)
  })

  it('can have a token as both input and output', () => {
    const route = new Route([pair_0_weth, pair_0_1, pair_1_weth], weth, weth)
    expect(route.pairs).toEqual([pair_0_weth, pair_0_1, pair_1_weth])
    expect(route.input).toEqual(weth)
    expect(route.output).toEqual(weth)
  })

  it('supports ether input', () => {
    const route = new Route([pair_0_weth], ETHER, token0)
    expect(route.pairs).toEqual([pair_0_weth])
    expect(route.input).toEqual(ETHER)
    expect(route.output).toEqual(token0)
  })

  it('supports ether output', () => {
    const route = new Route([pair_0_weth], token0, ETHER)
    expect(route.pairs).toEqual([pair_0_weth])
    expect(route.input).toEqual(token0)
    expect(route.output).toEqual(ETHER)
  })
})
