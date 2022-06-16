import fs from 'fs';
import path from 'path';

const path_ranges = path.resolve(__dirname, `./data/ranges.txt`);
const path_memes = path.resolve(__dirname, `./data/memes.txt`);

import dotenv from 'dotenv';
dotenv.config();

import { ethers, Contract } from 'ethers';
import contracts from './node_modules/synthetix/publish/deployed/mainnet-ovm/deployment.json';

const providerOE = new ethers.providers.WebSocketProvider(process.env.API_KEY_OE_MAINNET || '');
const signer = new ethers.Wallet(process.env.PRIVATE_KEY ?? '', providerOE);

import { TwitterApi } from 'twitter-api-v2';

const appKey = process.env.TWITTER_API_KEY ? process.env.TWITTER_API_KEY : '';
const appSecret = process.env.TWITTER_API_SECRET ? process.env.TWITTER_API_SECRET : '';
const accessToken = process.env.TWITTER_ACCESS_TOKEN ? process.env.TWITTER_ACCESS_TOKEN : '';
const accessSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET
    ? process.env.TWITTER_ACCESS_TOKEN_SECRET
    : '';

const twitter = new TwitterApi({
    appKey: appKey,
    appSecret: appSecret,
    accessToken: accessToken,
    accessSecret: accessSecret,
});

async function getMarkets() {
    const managerABI = contracts.sources.FuturesMarketManager.abi;
    const managerAddr = contracts.targets.FuturesMarketManager.address;
    const manager = new ethers.Contract(managerAddr, managerABI, providerOE);

    const markets = await manager.allMarkets();
    const marketABI = contracts.sources.FuturesMarket.abi;
    return markets.map((address: string) => new ethers.Contract(address, marketABI, signer));
}

function getMarketSymbols() {
    const marketSymbols = new Map();

    let targets = Object.entries(contracts.targets);
    for (let i = 0; i < targets.length; i++) {
        if (
            targets[i][1]['source'].includes('FuturesMarket') &&
            targets[i][1]['source'] != 'FuturesMarketManager' &&
            targets[i][1]['source'] != 'FuturesMarketData' &&
            targets[i][1]['source'] != 'FuturesMarketSettings'
        ) {
            marketSymbols.set(
                targets[i][1]['address'],
                targets[i][1]['name'].replace('FuturesMarket', 's')
            );
        }
    }

    return marketSymbols;
}

type Liquidations = {
    marketSymbol: string;
    size: string;
    price: string;
};

function makeFloat(input: string) {
    return parseFloat(ethers.utils.formatEther(ethers.BigNumber.from(input)));
}

function loadRanges() {
    const rangeFile = fs.readFileSync(path_ranges, { flag: 'r+' });
    const rangeFileSplit = rangeFile.toString().replace(/\r\n/g, '\n').split('\n');
    const ranges: number[] = [];
    for (let i = 0; i < rangeFileSplit.length; i++) {
        ranges.push(parseInt(rangeFileSplit[i]));
    }

    return ranges;
}

function loadMemes() {
    const memeFile = fs.readFileSync(path_memes, { flag: 'r+' });
    return memeFile.toString().replace(/\r\n/g, '\n').split('\n');
}

function getFlavorText(liquidation: Liquidations) {
    let ranges = loadRanges();
    let memes = loadMemes();

    let sizeOfMemeRange = Math.round(memes.length / ranges.length);
    let value = makeFloat(liquidation.size) * makeFloat(liquidation.price);

    let i = ranges.length - 1;
    for (; i > 0; i--) {
        if (value > ranges[i]) {
            break;
        }
    }
    // let rangeTopIndex = i * sizeOfMemeRange + (sizeOfMemeRange - 1);
    let rangeBottomIndex = i * sizeOfMemeRange;
    let memeIndex = Math.floor(Math.random() * sizeOfMemeRange) + rangeBottomIndex;

    return memes[memeIndex];
}

function getTweet(liquidation: Liquidations) {
    let dollarUSLocale = Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        useGrouping: false,
    });

    let flavorText = getFlavorText(liquidation);
    let tweet =
        '🚫 Liquidated ' +
        ethers.utils.formatEther(ethers.BigNumber.from(liquidation.size)).substring(0, 7) +
        ' ' +
        liquidation.marketSymbol +
        ' at ' +
        dollarUSLocale.format(makeFloat(liquidation.price)) +
        ' 🚫\n\n' +
        flavorText;

    return tweet;
}

async function main() {
    const markets: Contract[] = await getMarkets();
    const marketSymbols = getMarketSymbols();

    // const testLiq = {
    //     marketSymbol: marketSymbols.get('0xf86048DFf23cF130107dfB4e6386f574231a5C65'),
    //     size: '-210194164287220310'.replace('-', ''),
    //     price: '1239480485360000000000',
    // };

    // let testTweet = getTweet(testLiq);
    // console.log(testTweet);
    // twitter.v2.tweet(testTweet);

    for (const market of markets) {
        market.on(
            'PositionLiquidated',
            async (id, account, liquidator, size, price, fee, event) => {
                const liquidation = {
                    marketSymbol: marketSymbols.get(market.address),
                    size: size.toString().replace('-', ''),
                    price: price.toString(),
                };

                let tweet = getTweet(liquidation);
                console.log(tweet);
                twitter.v2.tweet(tweet);
            }
        );

        console.log(`Listening for ${marketSymbols.get(market.address)} liquidations`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
