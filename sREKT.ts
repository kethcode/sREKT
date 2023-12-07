import fs from 'fs';
import path from 'path';

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

const path_ranges = path.resolve(__dirname, `./data/ranges.txt`);
const path_memes = path.resolve(__dirname, `./data/memes.txt`);

import dotenv from 'dotenv';
dotenv.config();

import { ethers, Contract } from 'ethers';
import contracts from './node_modules/synthetix/publish/deployed/mainnet-ovm/deployment.json';

// https://github.com/Synthetixio/synthetix/blob/bf9d09d9d4d6d4222aaf4501592d602edf9e302d/contracts/PerpsV2MarketLiquidate.sol#L215
// keccak256("PositionLiquidated(uint256,address,address,int256,uint256,uint256,uint256,uint256)")
const liquidationEventHash = '0x8e83cfbf9c95216dce50909e376c0dcc3e23129a3aa1edd5013fa8b41648f883';

// https://github.com/Synthetixio/synthetix/blob/bf9d09d9d4d6d4222aaf4501592d602edf9e302d/contracts/PerpsV2MarketProxyable.sol#LL292C20-L292C106
// keccak256("PositionModified(uint256,address,uint256,int256,int256,uint256,uint256,uint256,int256)")
const positionModifiedHash = '0xc0d933baa356386a245ade48f9a9c59db4612af2b5b9c17de5b451c628760f43';

const eventABI = [
    'event PositionLiquidated(uint256 id, address account, address liquidator, int256 size, uint256 price, uint256 flaggerFee, uint256 liquidatorFee, uint256 stakersFee)',
    'event PositionModified(uint256 indexed id, address indexed account, uint256 margin, int256 size, int256 tradeSize, uint256 lastPrice, uint256 fundingIndex, uint256 fee, int256 skew)',
];

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

    // overloaded function names need signature in ethers
    const markets = await manager['allMarkets(bool)'](true);
    // const marketABI = contracts.sources.PerpsV2Market.abi;
    // const marketABI = contracts.sources.PerpsV2MarketLiquidate.abi;
    const marketABI = eventABI;
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
            targets[i][1]['source'] != 'PerpsV2MarketDelayedOrdersOffchain' &&
            targets[i][1]['source'] != 'PerpsV2MarketDelayedIntent' &&
            targets[i][1]['source'] != 'PerpsV2MarketDelayedExecution' &&
            targets[i][1]['source'] != 'PerpsV2MarketLiquidate'
        ) {
            // console.log(targets[i][1]['source']);
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

enum mutex {
    Locked = 1,
    Unlocked,
}

const tweetBuffer: string[] = [];
let tweetBufferMutex: mutex = mutex.Unlocked;

const addToTweetBuffer = async (tweet: string) => {
    while (tweetBufferMutex == mutex.Locked) {
        await delay(1000);
    }
    tweetBufferMutex = mutex.Locked;
    tweetBuffer.push(tweet);
    console.log('added tweet:', tweet);
    tweetBufferMutex = mutex.Unlocked;
};

const publishFromTweetBuffer = async () => {
    tweetBufferMutex = mutex.Locked;
    while (tweetBuffer.length > 0) {
        try {
            let tweet = tweetBuffer.shift();
            if (tweet) {
                console.log('posted tweet:', tweet);
                twitter.v2.tweet(tweet);
            }
        } catch (e) {
            console.log(
                new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '') +
                    ' publishFromTweetBuffer:' +
                    e
            );
        }
        await delay(1000);
    }
    tweetBufferMutex = mutex.Unlocked;
};

async function main() {
    console.log('Refreshing Markets');
    const markets: Contract[] = await getMarkets();
    const marketSymbols = await getMarketSymbols();

    // const testLiq = {
    //     marketSymbol: marketSymbols.get('0x2B3bb4c683BFc5239B029131EEf3B1d214478d93'),
    //     posSize: '210194164287220310'.replace('-', ''),
    //     type: makeFloat('210194164287220310') > 0 ? 'LONG' : 'SHORT',
    //     price: '1239480485360000000000',
    // };

    // let testTweet = getTweet(testLiq);
    // addToTweetBuffer('test1:' + testTweet);
    // addToTweetBuffer('test2:' + testTweet);
    // addToTweetBuffer('test3:' + testTweet);
    // publishFromTweetBuffer();

    // const eventABI = [
    //     'event PositionLiquidated(uint256 id, address account, address liquidator, int256 size, uint256 price, uint256 flaggerFee, uint256 liquidatorFee, uint256 stakersFee)',
    //     'event PositionModified(uint256 indexed id, address indexed account, uint256 margin, int256 size, int256 tradeSize, uint256 lastPrice, uint256 fundingIndex, uint256 fee, int256 skew)',
    // ];

    for (const market of markets) {
        const filterLiquidation = {
            address: market.address,
            //topics: [liquidationEventHash],
            topics: [
                ethers.utils.id(
                    'PositionLiquidated(uint256,address,address,int256,uint256,uint256,uint256,uint256)'
                ),
            ],
        };

        market.on(
            filterLiquidation,
            //async (id, account, liquidator, size, price, flagFee, liqFee, margin, event) => {
            async (
                id,
                account,
                liquidator,
                size,
                price,
                flaggerFee,
                liquidatorFee,
                stakersFee,
                event
            ) => {
// console.log(
                //     'liquidation:',
                //     id,
                //     account,
                //     liquidator,
                //     size,
                //     price,
                //     flaggerFee,
                //     liquidatorFee,
                //     stakersFee,
                //     event
                // );
                const liquidation = {
                    marketSymbol: marketSymbols.get(market.address),
                    posSize: size.toString().replace('-', ''),
                    type: makeFloat(size) > 0 ? 'LONG' : 'SHORT',
                    price: price.toString(),
                };
                if(liquidation.posSize >= 100000)
                {
                    addToTweetBuffer(getTweet(liquidation));
                    publishFromTweetBuffer();
                }
            }
        );

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
