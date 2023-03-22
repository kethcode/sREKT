import fs from 'fs';
import path from 'path';

const path_ranges = path.resolve(__dirname, `./data/ranges.txt`);
const path_memes = path.resolve(__dirname, `./data/memes.txt`);

import dotenv from 'dotenv';
dotenv.config();

import { ethers, Contract } from 'ethers';
import contracts from './node_modules/synthetix/publish/deployed/mainnet-ovm/deployment.json';

// keccak256("PositionLiquidated(uint256,address,address,int256,uint256,uint256)")
// keccak256("PositionModified(uint256,address,uint256,int256,int256,uint256,uint256,uint256)")
const liquidationEventHash = '0x62e7eb6698aabc6740afc94f06bbdfb947fc109fd24d4adb26014d44053ac2c3';
const positionModifiedHash = '0x930fd93131df035ac630ef616ad4212af6370377bf327e905c2724cd01d95097';

const providerOE = new ethers.providers.WebSocketProvider(process.env.API_KEY_OE_MAINNET || '');
const signer = new ethers.Wallet(process.env.PRIVATE_KEY ?? '', providerOE);

import { TwitterApi } from 'twitter-api-v2';

const appKey = process.env.TWITTER_API_KEY ?? '';
const appSecret = process.env.TWITTER_API_SECRET ?? '';
const accessToken = process.env.TWITTER_ACCESS_TOKEN ?? '';
const accessSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET ?? '';

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

    //const markets = await manager.allMarkets();
    // overloaded function names need signature in ethers
    const markets = await manager['allMarkets(bool)'](true);
    const marketABI = contracts.sources.PerpsV2Market.abi;
    return markets.map((address: string) => new ethers.Contract(address, marketABI, signer));
}

async function getMarketSymbols() {
    const marketSymbols = new Map();
    const perpsV2MarketABI = contracts.sources.PerpsV2Market.abi;

    let targets = Object.entries(contracts.targets);
    for (let i = 0; i < targets.length; i++) {
        if (
            targets[i][1]['source'].includes('PerpsV2Market') &&
            targets[i][1]['source'] != 'PerpsV2MarketData' &&
            targets[i][1]['source'] != 'PerpsV2MarketSettings' &&
            targets[i][1]['source'] != 'PerpsV2MarketState' &&
            targets[i][1]['source'] != 'PerpsV2MarketViews' &&
            targets[i][1]['source'] != 'PerpsV2MarketDelayedOrders' &&
            targets[i][1]['source'] != 'PerpsV2MarketDelayedOrdersOffchain'
        ) {
            const perpsV2Market = new ethers.Contract(
                targets[i][1]['address'],
                perpsV2MarketABI,
                signer
            );
            const parentAddress = await perpsV2Market.proxy();

            marketSymbols.set(
                parentAddress,
                '$'.concat(
                    '',
                    targets[i][1]['name'].replace('PerpsV2Market', '').replace('PERP', '')
                )
            );
        }
    }
    return marketSymbols;
}

type Liquidations = {
    marketSymbol: string;
    posSize: string;
    type: string;
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

function getSkulls(liquidation: Liquidations) {
    let ranges = loadRanges();
    let value = makeFloat(liquidation.posSize) * makeFloat(liquidation.price);

    let i = ranges.length - 1;
    for (; i > 0; i--) {
        if (value > ranges[i]) {
            break;
        }
    }
    let skulls = '💀'.repeat(i + 1);
    return skulls;
}

function getFlavorText(liquidation: Liquidations) {
    let ranges = loadRanges();
    let memes = loadMemes();

    let sizeOfMemeRange = Math.round(memes.length / ranges.length);
    let value = makeFloat(liquidation.posSize) * makeFloat(liquidation.price);

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

    let skulls = getSkulls(liquidation);
    let flavorText = getFlavorText(liquidation);
    let tweet =
        skulls +
        //'💀 Liquidated ' +
        ' Liquidated ' +
        ethers.utils.formatEther(ethers.BigNumber.from(liquidation.posSize)).substring(0, 7) +
        ' ' +
        liquidation.marketSymbol +
        ' ' +
        liquidation.type +
        ' @ ' +
        dollarUSLocale.format(makeFloat(liquidation.price)) +
        '\n\n' +
        flavorText;
    return tweet;
}

const tweetBuffer: string[] = [];
var cron = require('node-cron');
// once a minute
cron.schedule('* * * * *', () => {
    try {
        publishFromTweetBuffer();
    } catch (e) {
        console.log('cron.schedule: ' + e);
    }
});

const publishFromTweetBuffer = () => {
    while (tweetBuffer.length > 0) {
        try {
            let tweet = tweetBuffer.shift();
            if (tweet) {
                console.log('posted tweet:', tweet);
                twitter.v2.tweet(tweet);
            }
        } catch (e) {
            //console.error('publishFromTweetBuffer: ' + e);
            console.log(
                new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '') +
                    ' publishFromTweetBuffer:' +
                    e
            );
        }
    }
};

async function main() {
    const markets: Contract[] = await getMarkets();
    const marketSymbols = await getMarketSymbols();

    // const testLiq = {
    //     marketSymbol: marketSymbols.get('0x2B3bb4c683BFc5239B029131EEf3B1d214478d93'),
    //     posSize: '210194164287220310'.replace('-', ''),
    //     type: makeFloat('210194164287220310') > 0 ? 'LONG' : 'SHORT',
    //     price: '1239480485360000000000',
    // };

    // let testTweet = getTweet(testLiq);
    // console.log('added tweet x3:', testTweet);
    // tweetBuffer.push('test1:' + testTweet);
    // tweetBuffer.push('test2:' + testTweet);
    // tweetBuffer.push('test3:' + testTweet);
    // // twitter.v2.tweet(tweet);

    for (const market of markets) {
        const filterLiquidation = {
            address: market.address,
            topics: [liquidationEventHash],
        };

        const filterPosition = {
            address: market.address,
            topics: [positionModifiedHash],
        };

        market.on(filterLiquidation, async (id, account, liquidator, size, price, fee, event) => {
            const liquidation = {
                marketSymbol: marketSymbols.get(market.address),
                posSize: size.toString().replace('-', ''),
                type: makeFloat(size) > 0 ? 'LONG' : 'SHORT',
                price: price.toString(),
            };
            let tweet = getTweet(liquidation);
            tweetBuffer.push(tweet);
            console.log('added tweet:', tweet);
            // twitter.v2.tweet(tweet);
        });

        // market.on(filterPosition, async (id, account, liquidator, size, price, fee, event) => {
        //     // console.log('position modified:', id, account, liquidator, size, price, fee, event);
        //     const position = {
        //         marketSymbol: marketSymbols.get(market.address),
        //         posSize: size.toString().replace('-', ''),
        //         type: makeFloat(size) > 0 ? 'LONG' : 'SHORT',
        //         price: price.toString(),
        //     };

        //     console.log('position modified:', position);
        //     // const liquidation = {
        //     //     marketSymbol: marketSymbols.get(market.address),
        //     //     posSize: size.toString().replace('-', ''),
        //     //     type: makeFloat(size) > 0 ? 'LONG' : 'SHORT',
        //     //     price: price.toString(),
        //     // };
        //     // let tweet = getTweet(liquidation);
        //     // tweetBuffer.push(tweet);
        //     // console.log('added tweet:', tweet);
        //     // // twitter.v2.tweet(tweet);
        // });

        console.log(
            `Listening for ${marketSymbols.get(market.address)} liquidations on contract ${
                market.address
            }`
        );
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
