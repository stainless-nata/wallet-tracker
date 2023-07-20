import http from "http";
import ethers from "ethers";
import express from "express";
import fs from "fs";
import chalk from "chalk";
import BlocknativeSDK from "bnc-sdk";
import WebSocket from "ws";
import axios from "axios";
import fetch from "node-fetch";
import { Alchemy, Network } from "alchemy-sdk";

import { Client, Collection, GatewayIntentBits, Events } from "discord.js";

import data from "./config.js";
import { address, blacklists, markets } from "./config.js";

const app = express();
const httpServer = http.createServer(app); // server handler

const delay = (ms) => new Promise((res) => setTimeout(res, ms)); // delay time
let limitCount = 0;

const alchemy = new Alchemy({
  // Alchemy handler
  apiKey: data.ALCHEMY_API_KEY_WALLET,
  network: Network.ETH_MAINNET,
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] }); // discord.js handler

// Initial set values
let provider = new ethers.providers.JsonRpcProvider(
  "https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161"
);
let _configuration = [
  {
    name: "global",
    id: "global",
    filters: [
      {
        status: "confirmed",
      },
      {
        gasUsed: {
          gt: data.GAS_FEE,
        },
      },
    ],
    type: "global",
  },
];

var alerts = JSON.parse(fs.readFileSync("./mint-address.json", "utf-8"));
var marketplace = JSON.parse(
  fs.readFileSync("./marketplace-address.json", "utf-8")
);
var stats = JSON.parse(fs.readFileSync("./stats.json", "utf-8"));

for (const key in address) {
  if (alerts[key] == undefined) alerts[key] = {};
  if (marketplace[key] == undefined) marketplace[key] = {};
}

/*****************************
 * Cycling functions
 ******************************/

const setMarketplaceAddresses = () => {
  notify(
    "Counts for Secondary Marketplace has been set",
    "None",
    [],
    data.NFT_MARKETPLACE_ALERT_ID,
    ""
  );
  for (const key in address) marketplace[key] = {};

  save("marketplace-address", marketplace);
  setTimeout(() => setMarketplaceAddresses(), 1000 * 60 * 60 * 48); // sync every 48 hours, 1000 = 1 sec
};

/*****************************************************************************************************
 * Combind Functions
 * ***************************************************************************************************/

const save = (type, obj) => {
  let myJSON = JSON.stringify(obj);
  fs.writeFile(`./${type}.json`, myJSON, (err) => {
    if (err) console.log(err);
    // console.log(`${type} Saved!`);
  });
};

async function sdkSetup(sdk, configuration) {
  const parsedConfiguration =
    typeof configuration === "string"
      ? JSON.parse(configuration)
      : configuration;
  const globalConfiguration = parsedConfiguration.find(
    ({ id }) => id === "global"
  );
  const addressConfigurations = parsedConfiguration.filter(
    ({ id }) => id !== "global"
  );

  // save global configuration first and wait for it to be saved
  globalConfiguration &&
    (await sdk.configuration({
      scope: "global",
      filters: globalConfiguration.filters,
    }));

  addressConfigurations.forEach(({ id, filters, abi }) => {
    const abiObj = abi ? { abi } : {};
    sdk.configuration({ ...abiObj, filters, scope: id, watchAddress: true });
  });
}

const notify = (msg, type, params, channelId, img) => {
  const channel = client.channels.cache.get(channelId);
  if (type == "alert" || img == "#")
    channel.send({
      content: msg,
      tts: false,
      embeds: [
        {
          type: "rich",
          // "title": `Alert Info`,
          // "description": `Contract Info`,
          color: 0x00ffff,
          fields: params,
        },
      ],
    });
  else if (type == "image")
    channel.send({
      content: msg,
      tts: false,
      embeds: [
        {
          type: "rich",
          // "title": `Alert Info`,
          // "description": `Contract Info`,
          color: 0x00ffff,
          fields: params,
          thumbnail: {
            url: img,
          },
        },
      ],
    });
  else channel.send(msg);
};

const initCommand = () => {
  try {
    client.application.commands.set([
      {
        name: "analyze",
        description: "Analyze Info",
        type: 1,
        options: [
          {
            name: "analyze_address",
            type: 3,
            description: "address",
            required: true,
          },
        ],
      },
      {
        name: "check",
        description: "Check Collection address",
        type: 1,
        options: [
          {
            name: "collection-address",
            type: 3,
            description: "collection-address",
            required: true,
          },
        ],
      },
    ]);
  } catch (e) {
    console.log("Error in initCommand: " + e);
  }
};

const updateWalletsInfo = async () => {
  try {
    let count = 0;

    for (const i in address) {
      const responses = await getMultipleStatInfo(address[i]);

      for (const key in responses) {
        const res = responses[key];
        const wallet = res.address;
        if (stats[wallet]) continue;
        console.log(`${wallet} wallet info is added`);
        count = count + 1;
        let obj = {};
        obj.isWhale = res.scores?.whaleness;
        obj.isDiamond = false;
        res.labels?.map(
          (key) =>
            (obj.isDiamond =
              key.name == "diamond" || key.name == "five-diamond"
                ? true
                : obj.isDiamond)
        );
        obj.hands = res.scores?.hands;
        obj.labels = res.labels;

        stats[wallet] = obj;
      }
    }
    save("stats", stats);
    console.log(`Stats updated - ${count} wallets are added`);
  } catch (e) {
    console.log("Error in updateWalletInfo: " + e);
  }
};

const updateStats = async (addr) => {
  try {
    const wallets = await getCollectWalletInfo(addr);
    const responses = await getMultipleStatInfo(wallets);

    let count = 0;

    for (const key in responses) {
      const res = responses[key];
      const wallet = res.address;
      if (stats[wallet]) continue;
      console.log(`${wallet} wallet info is added`);
      count = count + 1;
      let obj = {};
      obj.isWhale = res.scores?.whaleness;
      obj.isDiamond = false;
      res.labels?.map(
        (key) =>
          (obj.isDiamond =
            key.name == "diamond" || key.name == "five-diamond"
              ? true
              : obj.isDiamond)
      );
      obj.hands = res.scores?.hands;
      obj.labels = res.labels;

      stats[wallet] = obj;
    }
    save("stats", stats);
    console.log(`Stats updated - ${count} wallets are added`);
    return wallets;
  } catch (e) {
    console.log("Error in updateStats: " + e);
  }
};

const alertCollection = async (address, type) => {
  try {
    const info = await getContractInfo(address);
    const addr = await updateStats(address);

    // FloorPrice
    let floorPrice = await getFloorPrice(address);

    // TotalSupply
    const tokens = (await getContractInfo(address))?.totalSupply;

    // Get owners
    const owners = (await alchemy.nft.getOwnersForContract(address)).owners;
    limitCount++;
    console.log(limitCount);
    let wallets = [];

    if (type == "full") {
      wallets = owners;
    } else if (type == "list") {
      wallets = inOurList(owners);
      console.log(wallets);
    }
    // console.log(wallets);

    let params = [];

    // if (info) {
    if (info.contractName != "#")
      params.push({
        name: `Contract Name`,
        value: info.contractName == "" ? "#" : info.contractName,
        inline: true,
      });
    if (info.description != "#" && alerts[address] == undefined) {
      params.push({
        name: `Description`,
        value: info.description == "" ? "#" : info.description,
        inline: false,
      });
      alerts[address] = "#Notified";
    }
    const collectionUrl = await getCollectionUrl(address);
    let links = [`[Etherscan](https://etherscan.io/address/${address})`];

    if (wallets > 0) {
      links.push(`[CatchMint](https://catchmint.xyz/?address=${address})`);
      // links.push(`[IcyTools](https://icy.tools/collections/${address})`);
      links.push(`[Blur](https://beta.blur.io/collection/${address})`);
      // links.push(`[X2Y2](https://x2y2.io/collection/${address})`);
      links.push(`[OS](https://pro.opensea.io/collection/${address})`);
      // links.push(`[TinyAstro](https://tinyastro.io/analytics/${address})`);
      // links.push(`[Magically](https://magically.gg/collection/${address})`);
      links.push(`[NFTFlip](https://nftflip.ai/collection/${address})`);
      // links.push(`[NFTNerds](https://app.nftnerds.ai/collection/${address})`);
    }

    if (info.twitterUsername != "#") {
      links.push(`[Twitter](https://twitter.com/${info.twitterUsername})`);
    }

    params.push({
      name: `Links`,
      value: links.join(" ・ "),
      inline: false,
    });
    // Add Stats
    let diamond = 0,
      platinum = 0,
      flipper = 0,
      whales = 0,
      blue_chip = 0,
      smart_trader = 0,
      smart_minter = 0,
      top_trader = 0;
    for (const key in wallets) {
      if (!stats[wallets[key]]) continue;
      const labels = stats[wallets[key]].labels;
      for (const i in labels) {
        if (labels[i].name == "diamond") diamond++;
        if (labels[i].name == "five-diamond") platinum++;
        if (labels[i].name == "paperhand") flipper++;
        if (labels[i].name == "whale") whales++;
        if (labels[i].name == "blue-chip") blue_chip++;
        if (labels[i].name == "smart-money") smart_trader++;
        if (labels[i].name == "top-minter") smart_minter++;
        if (labels[i].name == "top-trader") top_trader++;
      }
    }
    console.log("Token Address: ", address); // Log the token address

    const contractInfo = await getContractInfo(address);

    console.log("Contract Info: ", contractInfo); // Log the returned contract info

    tokens = contractInfo.totalSupply;

    console.log("Total Supply (tokens): ", tokens); // Log the total supply

    let valueLines = [];
    if (tokens !== "#") {
      console.log("Inside the conditional block with tokens: ", tokens); // Log inside the condition
      valueLines.push(`🍬  ${tokens} Tokens Minted`);
    }
    if (wallets > 0) {
      valueLines.push(`👛  ${wallets} Wallets`);
    }
    if (floorPrice !== undefined) {
      valueLines.push(`💰  ${floorPrice} Floor`);
    }
    if (
      info.tokenType !== "#" &&
      info.tokenType !== "NO_SUPPORTED_NFT_STANDARD"
    ) {
      valueLines.push(`📜  ${info.tokenType}`);
    }
    if (valueLines.length > 0) {
      // Ensure there's at least one line to display
      params.push({
        name: `Contract Stats`,
        value: valueLines.join("\n"),
        inline: true,
      });
    }
    params.push({
      name: `Alerted Wallet Info`,
      value: `💎  ${diamond} Diamond Hand\n✨  ${platinum} Platinum Hand\n♻  ${flipper} Flipper\n🐋  ${whales} Whale`,
      inline: true,
    });
    params.push({
      name: `Alerted Wallet Info`,
      value: `🔹  ${blue_chip} Blue Chip\n🧠  ${smart_trader} Smart Trader\n🍃  ${smart_minter} Top Minter\n📈  ${top_trader} Top Trader`,
      inline: true,
    });

    return params;
  } catch (e) {
    console.log("Error in alertCollection: " + e);
  }
};

/*****************************************************************************************************
 * API calls
 * ***************************************************************************************************/

const getFloorPrice = async (addr) => {
  try {
    const res = (
      await axios.get(
        `https://eth-mainnet.g.alchemy.com/nft/v2/${data.ALCHEMY_API_KEY_WALLET}/getFloorPrice?contractAddress=${addr}&refreshCache=true`
      )
    ).data;
    limitCount++;
    console.log(limitCount);

    // console.log(res.openSea?.floorPrice);
    return res.openSea?.floorPrice;
  } catch (e) {
    console.log("Error in getFloorPrice" + e);
  }
};

const getContractInfo = async (addr) => {
  try {
    const res = (
      await axios.get(
        `https://eth-mainnet.g.alchemy.com/v2/${data.ALCHEMY_API_KEY_WALLET}/getContractMetadata?contractAddress=${addr}&refreshCache=true`
      )
    ).data.contractMetadata;
    limitCount++;
    console.log(limitCount);

    return {
      contractName: (res.name == undefined
        ? res.openSea.collectionName == undefined
          ? "#"
          : res.openSea.collectionName
        : res.name
      ).toString(),
      tokenType: (res.tokenType == undefined ? "#" : res.tokenType).toString(),
      totalSupply: (res.totalSupply == undefined
        ? "#"
        : res.totalSupply
      ).toString(),
      description: (res.openSea.description == undefined
        ? "#"
        : res.openSea.description
      ).toString(),
      floorPrice: (res.openSea.floorPrice == undefined
        ? "#"
        : res.openSea.floorPrice
      ).toString(),
      twitterUsername: (res.openSea.twitterUsername == undefined
        ? "#"
        : res.openSea.twitterUsername
      ).toString(),
      imageUrl: (res.openSea.imageUrl == undefined
        ? "#"
        : res.openSea.imageUrl
      ).toString(),
    };
  } catch (e) {
    console.log("Error in getContractInfo" + e);
    return {
      contractName: "#",
      tokenType: "#",
      totalSupply: "#",
      description: "#",
      floorPrice: "#",
      twitterUsername: "#",
      imageUrl: "#",
    };
  }
};

const getTokenInfo = async (addr, hash) => {
  try {
    console.info(`[${new Date().toISOString()}] Get Token Info`);

    let options = {
      method: "POST",
      url: `https://eth-mainnet.g.alchemy.com/v2/${data.ALCHEMY_API_KEY_WALLET}`,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      data: {
        id: 1,
        jsonrpc: "2.0",
        method: "alchemy_getAssetTransfers",
        params: [
          {
            fromBlock: "0x0",
            toBlock: "latest",
            category: ["erc721", "erc1155", "specialnft"],
            withMetadata: false,
            excludeZeroValue: true,
            maxCount: "0x32",
            fromAddress: addr,
            order: "desc",
          },
        ],
      },
    };

    let res = (await axios.request(options)).data.result.transfers;
    limitCount++;
    console.log(`[${new Date().toISOString()}] Limit count: ${limitCount}`);

    for (const key in res) {
      if (res[key].hash == hash) return res[key].rawContract.address;
    }

    options = {
      method: "POST",
      url: `https://eth-mainnet.g.alchemy.com/v2/${data.ALCHEMY_API_KEY_WALLET}`,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      data: {
        id: 1,
        jsonrpc: "2.0",
        method: "alchemy_getAssetTransfers",
        params: [
          {
            fromBlock: "0x0",
            toBlock: "latest",
            category: ["erc721", "erc1155", "specialnft"],
            withMetadata: false,
            excludeZeroValue: true,
            maxCount: "0x32",
            toAddress: addr,
            order: "desc",
          },
        ],
      },
    };
    res = (await axios.request(options)).data.result.transfers;
    limitCount++;
    console.log(`[${new Date().toISOString()}] Limit count: ${limitCount}`);

    for (const key in res) {
      if (res[key].hash == hash) return res[key].rawContract.address;
    }

    return null;
  } catch (e) {
    console.error(`[${new Date().toISOString()}] Error in getTokenInfo: `, e);
  }
};

const getStatInfo = async (addr) => {
  try {
    const result = await fetch(`https://rutherford.5.dev/api/scores/${addr}`, {
      // Authorization using Bearer token while Fetch
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer " + data.INTELLIGENCE_API_KEY,
      },
    });
    const res = await result.json();
    return res;
  } catch (e) {
    console.log("Error in getStatInfo" + e);
  }
};

const getMultipleStatInfo = async (addr) => {
  try {
    let res = [];
    let array = [];

    for (let i = 0; i < addr.length; i += 500) {
      array.push(addr.slice(i, i + 500));
    }

    for (const i in array) {
      let temp = [];
      for (const j in array[i]) {
        if (stats[array[i][j]] == undefined)
          temp.push(
            fetch(`https://rutherford.5.dev/api/scores/${array[i][j]}`, {
              // Authorization using Bearer token while Fetch
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                Authorization: "Bearer " + data.INTELLIGENCE_API_KEY,
              },
            }) // Send request for each id
          );
      }
      let response = await Promise.all(temp);
      res = res.concat(response);
    }

    for (const key in res) {
      res[key] = await res[key].json();
    }

    return res;
  } catch (e) {
    console.log("Error in getMultipleStatInfo: " + e);
  }
};

const getCollectWalletInfo = async (addr) => {
  try {
    const res = (
      await axios.get(
        `https://eth-mainnet.g.alchemy.com/nft/v2/${data.ALCHEMY_API_KEY_WALLET}/getOwnersForCollection?contractAddress=${addr}`
      )
    ).data.ownerAddresses;
    limitCount++;
    console.log(limitCount);

    return res;
  } catch (e) {
    console.log("Error in getCollectWalletInfo" + e);
  }
};

const getAlertCountFromContract = (contractAddress, addr) => {
  try {
    let count = 0;

    for (const key in addr) {
      if (addr[key][contractAddress] == undefined) continue;
      count = count + addr[key][contractAddress].length;
    }
    return count;
  } catch (e) {
    console.log("Error in getAlertCountFromContract" + e);
  }
};

const getCollectionUrl = async (addr) => {
  try {
    const res = (
      await axios.get(
        `https://eth-mainnet.g.alchemy.com/nft/v2/${data.ALCHEMY_API_KEY_WALLET}/getFloorPrice?contractAddress=${addr}&refreshCache=true`
      )
    ).data;
    limitCount++;
    console.log("Limit count:", limitCount);

    // console.log(res.openSea?.floorPrice);
    return res.openSea?.collectionUrl;
  } catch (e) {
    console.error(
      "Error in getCollectionUrl for contract address:",
      addr,
      "Error:",
      e
    );
  }
};

/*****************************************************************************************************
 * Check Functions
 * ***************************************************************************************************/

const checkMethodId = (input) => {
  const methodid = input.slice(0, 10).toLowerCase();
  // console.log(methodid);
  if (methodid == "0xa22cb465") {
    console.log("setApprovalForAll: " + methodid);
    return false;
  }
  if (methodid == "0x423f6cef") {
    console.log("safeTransfer: " + methodid);
    return false;
  }
  if (methodid == "0x42842e0e" || methodid == "0xb88d4fde") {
    console.log("safeTransferFrom: " + methodid);
    return false;
  }
  if (methodid == "0x23b872dd") {
    console.log("transferFrom: " + methodid);
    return false;
  }
  return true;
};

const isBlackList = (addr) => {
  for (const key in blacklists)
    if (blacklists[key].toLowerCase() == addr.toLowerCase()) return true;
  return false;
};

const isMarkets = (addr) => {
  for (const key in markets)
    if (markets[key].toLowerCase() == addr.toLowerCase()) return true;
  return false;
};

const inOurList = (owners) => {
  let wallets = [],
    res = [];
  for (const i in address) {
    for (const j in address[i]) {
      wallets.push(address[i][j]);
    }
  }

  for (const key in owners) {
    if (wallets.includes(owners[key].toLowerCase())) res.push(owners[key]);
  }
  return res;
};

/*****************************************************************************************************
 * Handler
 * ***************************************************************************************************/

async function handleTransactionEvent(transaction) {
  let tx = transaction.transaction;

  console.log(
    `[${new Date().toISOString()}] Transaction from ${tx.from} to ${tx.to}`
  );

  let fromAddress = tx.from.toLowerCase();
  let addressType = "None";
  for (const key in address) {
    const flag = address[key].find((addr) => addr == fromAddress);
    if (flag !== undefined) addressType = key;
  }
  console.info(`[${new Date().toISOString()}] Address type: ${addressType}`);

  if (addressType == "None") {
    // console.log(tx);
    return;
  }

  if (!checkMethodId(tx.input)) return;

  let toAddress = tx.to;
  const code = await provider.getCode(toAddress);

  if (code == "0x") {
    console.log("Not to Contract");
    return;
  }

  if (isBlackList(toAddress)) {
    console.log("Blacklisted to address!");
    return;
  }

  let addr;
  let tokenAddress;
  const isMarket = isMarkets(toAddress);

  if (isMarket) {
    tokenAddress = await getTokenInfo(tx.fromAddress, tx.hash);
    addr = marketplace[addressType][tokenAddress];
    if (!tokenAddress) return;
  } else addr = alerts[addressType][toAddress];

  if (addr == undefined) addr = [];

  if (addr.includes(fromAddress)) {
    console.warn(`[${new Date().toISOString()}] Duplicated transaction!`);
    return;
  }

  addr.push(fromAddress);
  if (isMarket) marketplace[addressType][tokenAddress] = addr;
  else alerts[addressType][toAddress] = addr;
  console.log(`[${new Date().toISOString()}] Updated address list:`, addr);

  let alertType = "None";
  if (addr.length == 3) alertType = "<@&1025482820598112369>";
  if (addr.length == 5) alertType = "<@&1025482935081644116>";
  if (addr.length == 10) alertType = "<@&1025482908141637702>";
  if (addr.length == 25) alertType = "<@&1025482870174793738>";

  let addressSymbol;
  if (addressType == "UND") addressSymbol = "<@&1025484789819641967>";
  if (addressType == "ROI") addressSymbol = "<@&1025484818949091501>";
  if (addressType == "Buttr") addressSymbol = "<@&1025484846484697140>";
  if (addressType == "MOMENTUM") addressSymbol = "<@&1031572962303819826>";
  if (addressType == "Weller") addressSymbol = "<@&1031950215328043048>";
  if (addressType == "Influencers") addressSymbol = "<@&1032806618334756945>";
  if (addressType == "Admitone") addressSymbol = "<@&1035229679042441286>";
  if (addressType == "NftFlip") addressSymbol = "<@&1060708004284071947>";
  if (addressType == "OCB") addressSymbol = "<@&1049549301828829235>";
  if (addressType == "MVHQ") addressSymbol = "<@&1046206749880877096>";
  if (addressType == "Proof") addressSymbol = "<@&1045942747200245842>";
  if (addressType == "Japan") addressSymbol = "<@&1038687252970225724>";
  if (addressType == "FlurGold") addressSymbol = "<@&1039203766928424992>";
  if (addressType == "Cryptoninja") addressSymbol = "<@&1038689817787109376>";
  if (addressType == "Wumbo") addressSymbol = "<@&1038629683484426241>";
  if (addressType == "ClubMomo") addressSymbol = "<@&1025481108625838191>";

  // Normal Alert
  if (alertType !== "None") {
    console.info(
      `[${new Date().toISOString()}] Processing normal alert for address ${tokenAddress}`
    );

    let params = [];
    let msg;
    if (isMarket) {
      const info = await getContractInfo(tokenAddress);
      console.info(
        `[${new Date().toISOString()}] Contract information: `,
        info
      );

      let firstAlert = false;

      if (marketplace[tokenAddress] == undefined) {
        firstAlert = true;
        marketplace[tokenAddress] = "#Notified";
      }

      // if (info) {
      if (info.contractName != "#")
        params.push({
          name: `Contract Name`,
          value: info.contractName == "" ? "#" : info.contractName,
          inline: true,
        });
      if (info.description != "#" && firstAlert)
        params.push({
          name: `Description`,
          value: info.description == "" ? "#" : info.description,
          inline: false,
        });
      // Retrieve collection URL and process owners
      const collectionUrl = await getCollectionUrl(tokenAddress);
      console.info(
        `[${new Date().toISOString()}] Collection URL: ${collectionUrl}`
      );

      // Get owners and process wallet statistics
      const owners = await alchemy.nft.getOwnersForContract(tokenAddress);

      // Increment limit count and log current value
      limitCount++;
      console.log(`[${new Date().toISOString()}] Limit count: ${limitCount}`);
      let wallets = owners.owners.length;
      let links = [`[Etherscan](https://etherscan.io/address/${tokenAddress})`];

      if (wallets > 0) {
        links.push(
          `[CatchMint](https://catchmint.xyz/?address=${tokenAddress})`
        );
        // links.push(`[IcyTools](https://icy.tools/collections/${tokenAddress})`);
        links.push(`[Blur](https://beta.blur.io/collection/${tokenAddress})`);
        // links.push(`[X2Y2](https://x2y2.io/collection/${tokenAddress})`);
        links.push(`[OS](https://pro.opensea.io/collection/${tokenAddress})`);
        // links.push(
        //   `[TinyAstro](https://tinyastro.io/analytics/${tokenAddress})`
        // );
        // links.push(
        //   `[Magically](https://magically.gg/collection/${tokenAddress})`
        // );
        links.push(`[NFTFlip](https://nftflip.ai/collection/${tokenAddress})`);
        // links.push(
        //   `[NFTNerds](https://app.nftnerds.ai/collection/${tokenAddress})`
        // );
      }

      if (info.twitterUsername != "#") {
        links.push(`[Twitter](https://twitter.com/${info.twitterUsername})`);
      }

      params.push({
        name: `Links`,
        value: links.join(" ・ "),
        inline: false,
      });
      // Add Stats
      let diamond = 0,
        platinum = 0,
        flipper = 0,
        whales = 0,
        blue_chip = 0,
        smart_trader = 0,
        smart_minter = 0,
        top_trader = 0,
        tokens = 0;
      for (const key in addr) {
        if (!stats[addr[key]]) break;
        const labels = stats[addr[key]].labels;
        for (const i in labels) {
          if (labels[i].name == "diamond") diamond++;
          if (labels[i].name == "five-diamond") platinum++;
          if (labels[i].name == "paperhand") flipper++;
          if (labels[i].name == "whale") whales++;
          if (labels[i].name == "blue-chip") blue_chip++;
          if (labels[i].name == "smart-money") smart_trader++;
          if (labels[i].name == "top-minter") smart_minter++;
          if (labels[i].name == "top-trader") top_trader++;
        }
      }
      // Retrieve floor price and log it
      let floorPrice = await getFloorPrice(tokenAddress);
      console.info(`[${new Date().toISOString()}] Floor price: ${floorPrice}`);

      // TotalSupply
      tokens = (await getContractInfo(tokenAddress))?.totalSupply;

      let valueLines = [];
      if (tokens !== "#") {
        valueLines.push(`🍬  ${tokens} Tokens Minted`);
      }
      if (wallets > 0) {
        valueLines.push(`👛  ${wallets} Wallets`);
      }
      if (floorPrice !== 0 && floorPrice !== undefined) {
        valueLines.push(`💰  ${floorPrice} Floor`);
      }
      valueLines.push(`📜  ${info.tokenType}`);

      if (valueLines.length > 1) {
        // Ensure there's more than just the token type
        params.push({
          name: `Contract Stats`,
          value: valueLines.join("\n"),
          inline: true,
        });
      }

      params.push({
        name: `Alerted Wallet Info`,
        value: `💎  ${diamond} Diamond Hand\n✨  ${platinum} Platinum Hand\n♻  ${flipper} Flipper\n🐋  ${whales} Whale`,
        inline: true,
      });
      params.push({
        name: `Alerted Wallet Info`,
        value: `🔹  ${blue_chip} Blue Chip\n🧠  ${smart_trader} Smart Trader\n🍃  ${smart_minter} Top Minter\n📈  ${top_trader} Top Trader`,
        inline: true,
      });

      msg = `${alertType}: ${addr.length} wallets from ${addressSymbol} bought [${tokenAddress}] on a secondary marketplace`;
      notify(
        msg,
        firstAlert ? "image" : "alert",
        params,
        data.NFT_MARKETPLACE_ALERT_ID,
        info.imageUrl
      );

      console.log(msg, params);
    } else {
      const info = await getContractInfo(toAddress);
      let firstAlert = false;
      if (alerts[toAddress] == undefined) {
        firstAlert = true;
        alerts[toAddress] = "#Notified";
      }

      // if (info) {
      if (info.contractName != "#")
        params.push({
          name: `Contract Name`,
          value: info.contractName == "" ? "#" : info.contractName,
          inline: true,
        });
      if (info.description != "#" && firstAlert)
        params.push({
          name: `Description`,
          value: info.description == "" ? "#" : info.description,
          inline: false,
        });
      const collectionUrl = await getCollectionUrl(toAddress);
      // Get owners
      const owners = await alchemy.nft.getOwnersForContract(toAddress);
      limitCount++;
      console.log(limitCount);
      let wallets = owners.owners.length;
      let links = [`[Etherscan](https://etherscan.io/address/${toAddress})`];

      if (wallets > 0) {
        links.push(`[CatchMint](https://catchmint.xyz/?address=${toAddress})`);
        // links.push(`[IcyTools](https://icy.tools/collections/${toAddress})`);
        links.push(`[Blur](https://beta.blur.io/collection/${toAddress})`);
        // links.push(`[X2Y2](https://x2y2.io/collection/${toAddress})`);
        links.push(`[OS](https://pro.opensea.io/collection/${toAddress})`);
        // links.push(`[TinyAstro](https://tinyastro.io/analytics/${toAddress})`);
        // links.push(`[Magically](https://magically.gg/collection/${toAddress})`);
        links.push(`[NFTFlip](https://nftflip.ai/collection/${toAddress})`);
        // links.push(
        //   `[NFTNerds](https://app.nftnerds.ai/collection/${toAddress})`
        // );
      }

      if (info.twitterUsername != "#") {
        links.push(`[Twitter](https://twitter.com/${info.twitterUsername})`);
      }

      params.push({
        name: `Links`,
        value: links.join(" ・ "),
        inline: false,
      });

      // Add Stats
      let diamond = 0,
        platinum = 0,
        flipper = 0,
        whales = 0,
        blue_chip = 0,
        smart_trader = 0,
        smart_minter = 0,
        top_trader = 0,
        tokens = 0;
      for (const key in addr) {
        if (!stats[addr[key]]) break;
        const labels = stats[addr[key]].labels;
        for (const i in labels) {
          if (labels[i].name == "diamond") diamond++;
          if (labels[i].name == "five-diamond") platinum++;
          if (labels[i].name == "paperhand") flipper++;
          if (labels[i].name == "whale") whales++;
          if (labels[i].name == "blue-chip") blue_chip++;
          if (labels[i].name == "smart-money") smart_trader++;
          if (labels[i].name == "top-minter") smart_minter++;
          if (labels[i].name == "top-trader") top_trader++;
        }
      }
      // FloorPrice
      let floorPrice = await getFloorPrice(toAddress);

      // TotalSupply
      tokens = (await getContractInfo(toAddress))?.totalSupply;

      params.push({
        name: `Contract Stats`,
        value: `🍬  ${tokens} Tokens Minted\n👛  ${wallets} Wallets\n💰  ${floorPrice} Floor\n📜  ${info.tokenType}`,
        inline: true,
      });
      params.push({
        name: `Alerted Wallet Info`,
        value: `💎  ${diamond} Diamond Hand\n✨  ${platinum} Platinum Hand\n♻  ${flipper} Flipper\n🐋  ${whales} Whale`,
        inline: true,
      });
      params.push({
        name: `Alerted Wallet Info`,
        value: `🔹  ${blue_chip} Blue Chip\n🧠  ${smart_trader} Smart Trader\n🍃  ${smart_minter} Top Minter\n📈  ${top_trader} Top Trader`,
        inline: true,
      });

      msg = `${alertType}: ${addr.length} wallets from ${addressSymbol} interacted with ${toAddress}`;
      notify(
        msg,
        firstAlert ? "image" : "alert",
        params,
        data.NFT_MINTING_ALERT_ID,
        info.imageUrl
      );

      console.log(msg, params);
    }
  }

  // All Alert
  const contractAddress = isMarket ? tokenAddress : toAddress;
  const list = isMarket ? marketplace : alerts;

  const c = getAlertCountFromContract(contractAddress, list);
  // Update alertType based on the alert count

  alertType = "None";
  if (c == 5) alertType = "<@&1025482820598112369>";
  if (c == 5) alertType = "<@&1050472088877662250>";
  if (c == 10) alertType = "<@&1050472152253612053>";
  if (c == 15) alertType = "<@&1051548031046131752>";
  if (c == 20) alertType = "<@&1051548066651570247>";
  if (c == 25) alertType = "<@&1050472114160943204>";
  if (c == 50) alertType = "<@&1050472181320138803>";
  if (c == 100) alertType = "<@&1050472219693817976>";

  console.info(
    `[${new Date().toISOString()}] Processing all alert for contract address ${contractAddress} | Alert type: ${alertType}`
  );

  if (alertType !== "None") {
    addr = [];
    // Concatenating addresses

    for (const key in list) {
      if (list[key][contractAddress] == undefined) continue;
      addr = addr.concat(list[key][contractAddress]);
    }
    console.log(`[${new Date().toISOString()}] Addresses:`, addr);

    const info = await getContractInfo(contractAddress);
    console.info(`[${new Date().toISOString()}] Contract information: `, info);

    let params = [];
    let firstAlert = false;

    if (list[contractAddress] != "##Notified") {
      firstAlert = true;
      list[contractAddress] = "##Notified";
    }

    if (info.contractName != "#")
      params.push({
        name: `Contract Name`,
        value: info.contractName == "" ? "#" : info.contractName,
        inline: true,
      });
    if (info.description != "#" && firstAlert)
      params.push({
        name: `Description`,
        value: info.description == "" ? "#" : info.description,
        inline: false,
      });
    const collectionUrl = await getCollectionUrl(contractAddress);
    console.info(
      `[${new Date().toISOString()}] Collection URL: ${contractAddress}`
    );

    // Get owners
    const owners = await alchemy.nft.getOwnersForContract(contractAddress);
    limitCount++;
    console.log(`[${new Date().toISOString()}] Limit count: ${limitCount}`);
    let wallets = owners.owners.length;

    let links = [
      `[Etherscan](https://etherscan.io/address/${contractAddress})`,
    ];

    if (wallets > 0) {
      links.push(
        `[CatchMint](https://catchmint.xyz/?address=${contractAddress})`
      );
      // links.push(
      //   `[IcyTools](https://icy.tools/collections/${contractAddress})`
      // );
      links.push(`[Blur](https://beta.blur.io/collection/${contractAddress})`);
      // links.push(`[X2Y2](https://x2y2.io/collection/${contractAddress})`);
      links.push(`[OS](https://pro.opensea.io/collection/${contractAddress})`);
      // links.push(
      //   `[TinyAstro](https://tinyastro.io/analytics/${contractAddress})`
      // );
      // links.push(
      //   `[Magically](https://magically.gg/collection/${contractAddress})`
      // );
      links.push(`[NFTFlip](https://nftflip.ai/collection/${contractAddress})`);
      // links.push(
      //   `[NFTNerds](https://app.nftnerds.ai/collection/${contractAddress})`
      // );
    }

    if (info.twitterUsername != "#") {
      links.push(`[Twitter](https://twitter.com/${info.twitterUsername})`);
    }

    params.push({
      name: `Links`,
      value: links.join(" ・ "),
      inline: false,
    });

    // Add Stats
    let diamond = 0,
      platinum = 0,
      flipper = 0,
      whales = 0,
      blue_chip = 0,
      smart_trader = 0,
      smart_minter = 0,
      top_trader = 0,
      tokens = 0;
    for (const key in addr) {
      if (!stats[addr[key]]) break;
      const labels = stats[addr[key]].labels;
      for (const i in labels) {
        if (labels[i].name == "diamond") diamond++;
        if (labels[i].name == "five-diamond") platinum++;
        if (labels[i].name == "paperhand") flipper++;
        if (labels[i].name == "whale") whales++;
        if (labels[i].name == "blue-chip") blue_chip++;
        if (labels[i].name == "smart-money") smart_trader++;
        if (labels[i].name == "top-minter") smart_minter++;
        if (labels[i].name == "top-trader") top_trader++;
      }
    }
    // FloorPrice
    let floorPrice = await getFloorPrice(contractAddress);

    // TotalSupply
    tokens = (await getContractInfo(contractAddress))?.totalSupply;

    params.push({
      name: `Contract Stats`,
      value: `🍬  ${tokens} Tokens Minted\n👛  ${wallets} Wallets\n💰  ${floorPrice} Floor\n📜  ${info.tokenType}`,
      inline: true,
    });
    params.push({
      name: `Alerted Wallet Info`,
      value: `💎  ${diamond} Diamond Hand\n✨  ${platinum} Platinum Hand\n♻  ${flipper} Flipper\n🐋  ${whales} Whale`,
      inline: true,
    });
    params.push({
      name: `Alerted Wallet Info`,
      value: `🔹  ${blue_chip} Blue Chip\n🧠  ${smart_trader} Smart Trader\n🍃  ${smart_minter} Top Minter\n📈  ${top_trader} Top Trader`,
      inline: true,
    });

    const msg = isMarket
      ? `${alertType}: ${c} wallets bought [${contractAddress}]`
      : `${alertType}: ${c} wallets minted [${contractAddress}]`;
    notify(
      msg,
      firstAlert ? "image" : "alert",
      params,
      isMarket ? data.ALL_MARKETPLACE_ALERT_ID : data.ALL_MINT_ALERT_ID,
      info.imageUrl
    );

    notify(
      msg,
      firstAlert ? "image" : "alert",
      params,
      isMarket
        ? data.ALL_MARKETPLACE_ALERT_ID_BETA
        : data.ALL_MINT_ALERT_ID_BETA,
      info.imageUrl
    );

    /*     if (c >= 5)
      setTimeout(
        () =>
          notify(
            msg,
            firstAlert ? "image" : "alert",
            params,
            isMarket
              ? data.ALL_MARKETPLACE_ALERT_ID_DELTA
              : data.ALL_MINT_ALERT_ID_DELTA,
            info.imageUrl
          ),
        1000 * 60 * 3 // 3 minutes delay
      ); */
    console.log(msg, params);
  }
  save("mint-address", alerts);
  save("marketplace-address", marketplace);
}

const invokeConfiguration = (addr) => {
  let c = 0;
  let temp = addr.map((i) => {
    return {
      name: `My subscription ${++c}`,
      id: i,
      filters: [],
      type: "account",
    };
  });
  temp = [..._configuration, ...temp];

  return temp;
};

/*****************************************************************************************************
 * Find the new liquidity Pair with specific token while scanning the mempool in real-time.
 * ***************************************************************************************************/
const scanMempool = async () => {
  console.info(`[${new Date().toISOString()}] Starting mempool scan`);

  await updateWalletsInfo();

  let count = 0;

  const buffer = 45;

  for (const key in address) {
    let len = address[key].length;
    let id = 0;
    for (let i = 0; i < len; i = i + buffer) {
      const blocknative = new BlocknativeSDK({
        dappId: data.BLOCK_KEY,
        networkId: 1,
        transactionHandlers: [handleTransactionEvent],
        ws: WebSocket,
        name: key + id,
        onopen: () => {
          console.log(
            `[${new Date().toISOString()}] Connected to Blocknative with name ${
              key + id
            }`
          );
        },
        onerror: (error) => {
          count++;
          console.error(
            `[${new Date().toISOString()}] Error on Blocknative with name ${
              key + id
            } | Error:`,
            error
          );
        },
      });
      id++;

      let filter = invokeConfiguration(
        address[key].slice(i, i + buffer > len ? len : i + buffer)
      );
      await sdkSetup(blocknative, filter);
      await delay(1000);
    }
  }
  console.log(`[${new Date().toISOString()}] Error count: ${count}`);

  notify("Wallet Tracker started!", "None", [], data.NFT_MINTING_ALERT_ID, "");
  setTimeout(() => setMarketplaceAddresses(), 1000 * 60 * 60 * 48);

  console.log(chalk.red(`\n[${new Date().toISOString()}] Service Start ... `));
};

// Log in to Discord with your client's token
client.login(data.DISCORD_TOKEN);

client.on("ready", () => {
  console.log("Bot Ready!");
  initCommand();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "analyze") {
    await interaction.deferReply({ ephemeral: true });
    let option = interaction.options.get("analyze_address");
    let address = option.value;

    let msg = `Information for [${address}]`;
    let params = await alertCollection(address, "full");

    await interaction.editReply({
      content: msg,
      ephemeral: true,
      tts: false,
      embeds: [
        {
          type: "rich",
          // "title": `Alert Info`,
          // "description": `Contract Info`,
          color: 0x00ffff,
          fields: params,
        },
      ],
      ephemeral: true,
    });
    console.log(msg, params);
  }
  if (interaction.commandName === "check") {
    await interaction.deferReply({ ephemeral: true });
    let address = interaction.options.get("collection-address").value;

    let msg = `Information for [${address}]`;
    let params = await alertCollection(address, "list");

    await interaction.editReply({
      content: msg,
      ephemeral: false,
      tts: false,
      embeds: [
        {
          type: "rich",
          // "title": `Alert Info`,
          // "description": `Contract Info`,
          color: 0x00ffff,
          fields: params,
        },
      ],
      ephemeral: true,
    });
    console.log(msg, params);
  }
});

scanMempool();

const PORT = 9999;

httpServer.listen(PORT, console.log(chalk.yellow(`Start Wallet Tracker...`)));
