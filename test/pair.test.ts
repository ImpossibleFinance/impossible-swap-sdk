// TODO: maximum amount transfer - take from bounds + hardstops

import { Pair, TradeState } from '../src'
import JSBI from 'jsbi'
import { CurrencyAmount, Price, SupportedChainId, Token, WETH9 } from '@uniswap/sdk-core'

const BasicPair = (a: CurrencyAmount<Token>, b: CurrencyAmount<Token>): Pair => {
  return new Pair(a, b, false, 30, 1, 1, TradeState.SELL_ALL)
}

describe('Pair', () => {
  const USDC = new Token(SupportedChainId.MAINNET, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 18, 'USDC', 'USD Coin')
  const DAI = new Token(
    SupportedChainId.MAINNET,
    '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    18,
    'DAI',
    'DAI Stablecoin'
  )

  describe('constructor', () => {
    it('cannot be used for tokens on different chains', () => {
      expect(() =>
        BasicPair(
          CurrencyAmount.fromRawAmount(USDC, '100'),
          CurrencyAmount.fromRawAmount(WETH9[SupportedChainId.ARBITRUM_ONE], '100')
        )
      ).toThrow('CHAIN_IDS')
    })
  })

  describe('#getAddress', () => {
    it('returns the correct address', () => {
      expect(Pair.getAddress(USDC, DAI)).toEqual('0x6c599904Fce4D5c0dd66c80E49Cc87b24A07D0bA')
    })
  })

  describe('#token0', () => {
    it('always is the token that sorts before', () => {
      expect(
        BasicPair(CurrencyAmount.fromRawAmount(USDC, '100'), CurrencyAmount.fromRawAmount(DAI, '100')).token0
      ).toEqual(DAI)
      expect(
        BasicPair(CurrencyAmount.fromRawAmount(DAI, '100'), CurrencyAmount.fromRawAmount(USDC, '100')).token0
      ).toEqual(DAI)
    })
  })
  describe('#token1', () => {
    it('always is the token that sorts after', () => {
      expect(
        BasicPair(CurrencyAmount.fromRawAmount(USDC, '100'), CurrencyAmount.fromRawAmount(DAI, '100')).token1
      ).toEqual(USDC)
      expect(
        BasicPair(CurrencyAmount.fromRawAmount(DAI, '100'), CurrencyAmount.fromRawAmount(USDC, '100')).token1
      ).toEqual(USDC)
    })
  })
  describe('#reserve0', () => {
    it('always comes from the token that sorts before', () => {
      expect(
        BasicPair(CurrencyAmount.fromRawAmount(USDC, '100'), CurrencyAmount.fromRawAmount(DAI, '101')).reserve0
      ).toEqual(CurrencyAmount.fromRawAmount(DAI, '101'))
      expect(
        BasicPair(CurrencyAmount.fromRawAmount(DAI, '101'), CurrencyAmount.fromRawAmount(USDC, '100')).reserve0
      ).toEqual(CurrencyAmount.fromRawAmount(DAI, '101'))
    })
  })
  describe('#reserve1', () => {
    it('always comes from the token that sorts after', () => {
      expect(
        BasicPair(CurrencyAmount.fromRawAmount(USDC, '100'), CurrencyAmount.fromRawAmount(DAI, '101')).reserve1
      ).toEqual(CurrencyAmount.fromRawAmount(USDC, '100'))
      expect(
        BasicPair(CurrencyAmount.fromRawAmount(DAI, '101'), CurrencyAmount.fromRawAmount(USDC, '100')).reserve1
      ).toEqual(CurrencyAmount.fromRawAmount(USDC, '100'))
    })
  })

  describe('uniswap #token0Price', () => {
    it('returns price of token0 in terms of token1', () => {
      expect(
        BasicPair(CurrencyAmount.fromRawAmount(USDC, '101'), CurrencyAmount.fromRawAmount(DAI, '100')).token0Price
      ).toEqual(new Price(DAI, USDC, '100', '101'))
      expect(
        BasicPair(CurrencyAmount.fromRawAmount(DAI, '100'), CurrencyAmount.fromRawAmount(USDC, '101')).token0Price
      ).toEqual(new Price(DAI, USDC, '100', '101'))
    })
  })

  describe('uniswap #token1Price', () => {
    it('returns price of token1 in terms of token0', () => {
      expect(
        BasicPair(CurrencyAmount.fromRawAmount(USDC, '101'), CurrencyAmount.fromRawAmount(DAI, '100')).token1Price
      ).toEqual(new Price(USDC, DAI, '101', '100'))
      expect(
        BasicPair(CurrencyAmount.fromRawAmount(DAI, '100'), CurrencyAmount.fromRawAmount(USDC, '101')).token1Price
      ).toEqual(new Price(USDC, DAI, '101', '100'))
    })
  })

  describe('uniswap #priceOf', () => {
    const pair = BasicPair(CurrencyAmount.fromRawAmount(USDC, '101'), CurrencyAmount.fromRawAmount(DAI, '100'))
    it('returns price of token in terms of other token', () => {
      expect(pair.priceOf(DAI)).toEqual(pair.token0Price)
      expect(pair.priceOf(USDC)).toEqual(pair.token1Price)
    })

    it('throws if invalid token', () => {
      expect(() => pair.priceOf(WETH9[SupportedChainId.MAINNET])).toThrow('TOKEN')
    })
  })

  describe('#reserveOf', () => {
    it('returns reserves of the given token', () => {
      expect(
        BasicPair(CurrencyAmount.fromRawAmount(USDC, '100'), CurrencyAmount.fromRawAmount(DAI, '101')).reserveOf(USDC)
      ).toEqual(CurrencyAmount.fromRawAmount(USDC, '100'))
      expect(
        BasicPair(CurrencyAmount.fromRawAmount(DAI, '101'), CurrencyAmount.fromRawAmount(USDC, '100')).reserveOf(USDC)
      ).toEqual(CurrencyAmount.fromRawAmount(USDC, '100'))
    })

    it('throws if not in the pair', () => {
      expect(() =>
        BasicPair(CurrencyAmount.fromRawAmount(DAI, '101'), CurrencyAmount.fromRawAmount(USDC, '100')).reserveOf(
          WETH9[SupportedChainId.MAINNET]
        )
      ).toThrow('TOKEN')
    })
  })

  describe('#chainId', () => {
    it('returns the token0 chainId', () => {
      expect(
        BasicPair(CurrencyAmount.fromRawAmount(USDC, '100'), CurrencyAmount.fromRawAmount(DAI, '100')).chainId
      ).toEqual(SupportedChainId.MAINNET)
      expect(
        BasicPair(CurrencyAmount.fromRawAmount(DAI, '100'), CurrencyAmount.fromRawAmount(USDC, '100')).chainId
      ).toEqual(SupportedChainId.MAINNET)
    })
  })
  describe('#involvesToken', () => {
    expect(
      BasicPair(CurrencyAmount.fromRawAmount(USDC, '100'), CurrencyAmount.fromRawAmount(DAI, '100')).involvesToken(USDC)
    ).toEqual(true)
    expect(
      BasicPair(CurrencyAmount.fromRawAmount(USDC, '100'), CurrencyAmount.fromRawAmount(DAI, '100')).involvesToken(DAI)
    ).toEqual(true)
    expect(
      BasicPair(CurrencyAmount.fromRawAmount(USDC, '100'), CurrencyAmount.fromRawAmount(DAI, '100')).involvesToken(
        WETH9[SupportedChainId.MAINNET]
      )
    ).toEqual(false)
  })

  describe('uniswap amounts', () => {
    const inputAmount: CurrencyAmount<Token> = CurrencyAmount.fromRawAmount(USDC, '1000000000000000000') // 1
    const outputAmount: CurrencyAmount<Token> = CurrencyAmount.fromRawAmount(DAI, '987158034397061298') // 0.987
    expect(
      BasicPair(
        CurrencyAmount.fromRawAmount(USDC, '100000000000000000000'), // 100
        CurrencyAmount.fromRawAmount(DAI, '100000000000000000000')
      ) // 100
        .getOutputAmount(inputAmount)[0]
    ).toEqual(outputAmount)
  })

  const checkBounds = (actual: JSBI, expected: JSBI): boolean => {
    let a: boolean = JSBI.greaterThan(actual, JSBI.subtract(expected, JSBI.BigInt(5)))
    let b: boolean = JSBI.lessThan(actual, JSBI.add(expected, JSBI.BigInt(5)))

    return a && b
  }

  describe('sqrt calculations', () => {
    const tests = [
      { k: '10000000000000000000000000000', sqrtK: '100000000000000' },
      { k: '602311237141614639250714307746962364969', sqrtK: '24542030012645951437' },
      { k: '1051862615112527981932275442917763963209', sqrtK: '32432431532534343453' },
      { k: '23562247653695456410649294596', sqrtK: '153499992357314' },
      { k: '72911332743072652158956264288752431169', sqrtK: '8538813310002312737' }
    ]

    tests.forEach(elem => {
      const result: JSBI = BasicPair(
        CurrencyAmount.fromRawAmount(USDC, '1000'),
        CurrencyAmount.fromRawAmount(DAI, '1000')
      ).sqrt(JSBI.BigInt(elem.k))
      it('should be within +- 5wei', () => {
        expect(checkBounds(result, JSBI.BigInt(elem.sqrtK))).toBe(true)
      })
    })
  })

  // Parseint back to js int creates lower sensitivity (truncates ending 2-4 digits)
  describe('simple xybk K calculations', () => {
    const amounts = ['712372217218233337', '20000000000000000000', '12323242882232920249', '23929449492939909691']
    const boosts = [2, 10, 22, 42, 64, 129]

    it('should be within +- 5wei', () => {
      amounts.forEach(a => {
        boosts.forEach(b => {
          const result: JSBI = new Pair(
            CurrencyAmount.fromRawAmount(USDC, a),
            CurrencyAmount.fromRawAmount(DAI, a),
            true,
            30,
            b,
            b,
            TradeState.SELL_ALL
          ).sqrtK
          expect(checkBounds(result, JSBI.BigInt(a))).toBe(true)
        })
      })
    })
  })

  describe('complex xybk K calculations', () => {
    // doublecheck with wolframalpha: sqrt[(a+9sqrtK)(b+9sqrtK)] = 10*sqrtK
    const tests = [
      { a: '40000000000000000000', b: '10000000000000000000', sqrtK: '24542030012645951437' },
      { a: '712372217218233337', b: '12323242882232920249', sqrtK: '6248706546171356461' },
      { a: '23929449492939909691', b: '59583691923485939593', sqrtK: '41372671310355025387' },
      { a: '593851823945304530422', b: '110231230506929991235', sqrtK: '343541838342506044137' },
      { a: '2388425885349239233', b: '12323242882232920249', sqrtK: '7184309717907350868' }
    ]
    it('should be within +- 5wei', () => {
      tests.forEach(elem => {
        let result: JSBI = new Pair(
          CurrencyAmount.fromRawAmount(USDC, elem.a),
          CurrencyAmount.fromRawAmount(DAI, elem.b),
          true,
          30,
          10,
          10,
          TradeState.SELL_ALL
        ).sqrtK
        expect(checkBounds(result, JSBI.BigInt(elem.sqrtK))).toBe(true)
      })
    })
  })

  describe('uni amount calculations', () => {
    // test values from ImpossiblePair.spec.ts in impossible-swap-core
    const tests = [
      {
        reserve0: '100000000000000000000',
        reserve1: '100000000000000000000',
        amount0: '1000000000000000000',
        amount1: '987158034397061298'
      },
      {
        reserve0: '1000000000000000000000',
        reserve1: '1000000000000000000000',
        amount0: '1000000000000000000',
        amount1: '996006981039903216'
      },
      {
        reserve0: '982471445826763938256', // USDC
        reserve1: '987471445826763938256', // DAI
        amount0: '10000000000000000000',
        amount1: '9920071714348123486'
      }
    ]

    it('should be within +- 5wei', () => {
      tests.forEach(elem => {
        let input: CurrencyAmount<Token> = CurrencyAmount.fromRawAmount(DAI, elem.amount0)
        let output: [CurrencyAmount<Token>, CurrencyAmount<Token>, Pair] = new Pair(
          CurrencyAmount.fromRawAmount(DAI, elem.reserve0),
          CurrencyAmount.fromRawAmount(USDC, elem.reserve1),
          false,
          30,
          1,
          1,
          TradeState.SELL_ALL
        ).getOutputAmount(input)
        expect(checkBounds(output[0].numerator, JSBI.BigInt(elem.amount1))).toBe(true)

        expect(output[2].token1).toEqual(USDC) // reserve1 in pair object corresponds to reserve1
        expect(
          checkBounds(output[2].reserve0.numerator, JSBI.add(JSBI.BigInt(elem.reserve0), JSBI.BigInt(elem.amount0)))
        ).toBe(true)
        expect(
          checkBounds(
            output[2].reserve1.numerator,
            JSBI.subtract(JSBI.BigInt(elem.reserve1), JSBI.BigInt(elem.amount1))
          )
        ).toBe(true)
      })
    })

    it('should be within +- 5wei', () => {
      tests.forEach(elem => {
        let output: CurrencyAmount<Token> = CurrencyAmount.fromRawAmount(USDC, elem.amount1)
        let input: [CurrencyAmount<Token>, Pair] = new Pair(
          CurrencyAmount.fromRawAmount(DAI, elem.reserve0),
          CurrencyAmount.fromRawAmount(USDC, elem.reserve1),
          false,
          30,
          1,
          1,
          TradeState.SELL_ALL
        ).getInputAmount(output)

        expect(checkBounds(input[0].numerator, JSBI.BigInt(elem.amount0))).toBe(true)
        expect(input[1].token1).toEqual(USDC) // reserve1 in pair object corresponds to reserve0
        expect(
          checkBounds(input[1].reserve0.numerator, JSBI.add(JSBI.BigInt(elem.reserve0), JSBI.BigInt(elem.amount0)))
        ).toBe(true)
        expect(
          checkBounds(input[1].reserve1.numerator, JSBI.subtract(JSBI.BigInt(elem.reserve1), JSBI.BigInt(elem.amount1)))
        ).toBe(true)
      })
    })
  })

  describe('xybk amount calculations, single boost', () => {
    // test values from ImpossiblePair.spec.ts in impossible-swap-core
    const tests = [
      {
        reserve0: '10000000000000000000',
        reserve1: '10000000000000000000',
        amount0: '1000000000000000000',
        amount1: '987158034397061298'
      },
      {
        reserve0: '100000000000000000000',
        reserve1: '100000000000000000000',
        amount0: '1000000000000000000',
        amount1: '996006981039903216'
      },
      {
        reserve0: '96000000000000000000',
        reserve1: '101000000000000000000',
        amount0: '10000000000000000000',
        amount1: '9920071714348123486'
      }
    ]

    it('should be within +- 5wei', () => {
      tests.forEach(elem => {
        let input: CurrencyAmount<Token> = CurrencyAmount.fromRawAmount(DAI, elem.amount0)
        let output: [CurrencyAmount<Token>, CurrencyAmount<Token>, Pair] = new Pair(
          CurrencyAmount.fromRawAmount(DAI, elem.reserve0),
          CurrencyAmount.fromRawAmount(USDC, elem.reserve1),
          true,
          30,
          10,
          10,
          TradeState.SELL_ALL
        ).getOutputAmount(input)

        expect(checkBounds(output[0].numerator, JSBI.BigInt(elem.amount1))).toBe(true)

        expect(output[2].token1).toEqual(USDC) // reserve1 in pair object corresponds to reserve1
        expect(
          checkBounds(output[2].reserve0.numerator, JSBI.add(JSBI.BigInt(elem.reserve0), JSBI.BigInt(elem.amount0)))
        ).toBe(true)
        expect(
          checkBounds(
            output[2].reserve1.numerator,
            JSBI.subtract(JSBI.BigInt(elem.reserve1), JSBI.BigInt(elem.amount1))
          )
        ).toBe(true)
      })
    })

    it('should be within +- 5wei', () => {
      tests.forEach(elem => {
        let output: CurrencyAmount<Token> = CurrencyAmount.fromRawAmount(USDC, elem.amount1)
        let input: [CurrencyAmount<Token>, Pair] = new Pair(
          CurrencyAmount.fromRawAmount(DAI, elem.reserve0),
          CurrencyAmount.fromRawAmount(USDC, elem.reserve1),
          true,
          30,
          10,
          10,
          TradeState.SELL_ALL
        ).getInputAmount(output)

        expect(checkBounds(input[0].numerator, JSBI.BigInt(elem.amount0))).toBe(true)
        expect(input[1].token1).toEqual(USDC) // reserve1 in pair object corresponds to reserve0
        expect(
          checkBounds(input[1].reserve0.numerator, JSBI.add(JSBI.BigInt(elem.reserve0), JSBI.BigInt(elem.amount0)))
        ).toBe(true)
        expect(
          checkBounds(input[1].reserve1.numerator, JSBI.subtract(JSBI.BigInt(elem.reserve1), JSBI.BigInt(elem.amount1)))
        ).toBe(true)
      })
    })
  })

  describe('xybk amount calculations, double boost', () => {
    // test values from ImpossiblePair.spec.ts in impossible-swap-core
    const tests = [
      {
        reserve0: '98000000000000000000', // Pool of 98: 100
        reserve1: '100000000000000000000', // Trade 10 in
        amount0: '10000000000000000000',
        amount1: '9941982512178805534'
      },
      {
        reserve0: '102324241243449991944', // Pool of 102:124
        reserve1: '124882484835838434422', // Trade 50 in
        amount0: '50000000000000000000',
        amount1: '49488329728372278747'
      },
      {
        reserve0: '1242493953959349219344', // Pool of 1242:1310
        reserve1: '1310000000000000000000', // Trade 1000 in
        amount0: '1000000000000000000000',
        amount1: '971795130187252602772' // This outputs 971795130187252602770 but router outputs 971795130187252602772
      }
    ]

    it('should be within +- 5wei', () => {
      tests.forEach(elem => {
        let input: CurrencyAmount<Token> = CurrencyAmount.fromRawAmount(DAI, elem.amount0)
        let output: [CurrencyAmount<Token>, CurrencyAmount<Token>, Pair] = new Pair(
          CurrencyAmount.fromRawAmount(DAI, elem.reserve0),
          CurrencyAmount.fromRawAmount(USDC, elem.reserve1),
          true,
          30,
          28,
          11,
          TradeState.SELL_ALL
        ).getOutputAmount(input)

        expect(checkBounds(output[0].numerator, JSBI.BigInt(elem.amount1))).toBe(true)

        expect(output[2].token1).toEqual(USDC) // reserve1 in pair object corresponds to reserve1
        expect(
          checkBounds(output[2].reserve0.numerator, JSBI.add(JSBI.BigInt(elem.reserve0), JSBI.BigInt(elem.amount0)))
        ).toBe(true)
        expect(
          checkBounds(
            output[2].reserve1.numerator,
            JSBI.subtract(JSBI.BigInt(elem.reserve1), JSBI.BigInt(elem.amount1))
          )
        ).toBe(true)
      })
    })

    it('should be within +- 5wei', () => {
      tests.forEach(elem => {
        let output: CurrencyAmount<Token> = CurrencyAmount.fromRawAmount(USDC, elem.amount1)
        let input: [CurrencyAmount<Token>, Pair] = new Pair(
          CurrencyAmount.fromRawAmount(DAI, elem.reserve0),
          CurrencyAmount.fromRawAmount(USDC, elem.reserve1),
          true,
          30,
          28,
          11,
          TradeState.SELL_ALL
        ).getInputAmount(output)

        expect(checkBounds(input[0].numerator, JSBI.BigInt(elem.amount0))).toBe(true)
        expect(input[1].token1).toEqual(USDC) // reserve1 in pair object corresponds to reserve0
        expect(
          checkBounds(input[1].reserve0.numerator, JSBI.add(JSBI.BigInt(elem.reserve0), JSBI.BigInt(elem.amount0)))
        ).toBe(true)
        expect(
          checkBounds(input[1].reserve1.numerator, JSBI.subtract(JSBI.BigInt(elem.reserve1), JSBI.BigInt(elem.amount1)))
        ).toBe(true)
      })
    })
  })
})
