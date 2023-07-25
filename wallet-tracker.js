import http from "http";
import ethers from "ethers";
import express from "express";
import fs from "fs";
import chalk from "chalk";
import BlocknativeSDK from "bnc-sdk";
import WebSocket from "ws";
import { Alchemy, Network } from "alchemy-sdk";
import dotenv  from "dotenv"
import { Client, Collection, GatewayIntentBits, Events } from "discord.js";

import save from "./utils/save.js"
import notify from "./utils/notify.js"
import { getFloorPrice, getContractInfo, getTokenInfo, getCollectionUrl } from "./utils/api.js"
import { checkMethodId, isBlackList, isMarkets, inOurList } from './utils/check.js'
import { roles } from './utils/constants.js'
import { updateWalletsInfo, getAlertCountFromContract, alertCollection } from './utils/update.js'

import { address, blacklists, markets } from "./config/config.js";

dotenv.config()

const delay = (ms) => new Promise((res) => setTimeout(res, ms));
global.limitCount = 0;

const alchemy = new Alchemy({
  apiKey: process.env.ALCHEMY_API_KEY_WALLET,
  network: Network.ETH_MAINNET,
});

let provider = new ethers.providers.JsonRpcProvider(process.env.MAIN_URL);
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
          gt: process.env.GAS_FEE,
        },
      },
    ],
    type: "global",
  },
];

var alerts = JSON.parse(fs.readFileSync("./config/mint-address.json", "utf-8"));
var marketplace = JSON.parse(fs.readFileSync("./config/marketplace-address.json", "utf-8"));
var stats = JSON.parse(fs.readFileSync("./config/stats.json", "utf-8"));

for (const key in address) {
  if (alerts[key] == undefined) alerts[key] = {};
  if (marketplace[key] == undefined) marketplace[key] = {};
}

const setMarketplaceAddresses = () => {
  notify(client, "Counts for Secondary Marketplace has been set", "None", [], process.env.NFT_MARKETPLACE_ALERT_ID, "");

  for (const key in address) marketplace[key] = {};
  save("marketplace-address", marketplace);

  setTimeout(() => setMarketplaceAddresses(), 1000 * 60 * 60 * 48); // sync every 48 hours, 1000 = 1 sec
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

  if (isBlackList(toAddress, blacklists)) {
    console.log("Blacklisted to address!");
    return;
  }

  let addr;
  let tokenAddress;
  const isMarket = isMarkets(toAddress, markets);

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

  let addressSymbol = roles[addressType];

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
      global.limitCount++;
      console.log(`[${new Date().toISOString()}] Limit count: ${global.limitCount}`);
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
        client,
        msg,
        firstAlert ? "image" : "alert",
        params,
        process.env.NFT_MARKETPLACE_ALERT_ID,
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
      global.limitCount++;
      console.log(global.limitCount);
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
        client,
        msg,
        firstAlert ? "image" : "alert",
        params,
        process.env.NFT_MINTING_ALERT_ID,
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
    global.limitCount++;
    console.log(`[${new Date().toISOString()}] Limit count: ${global.limitCount}`);
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
      client,
      msg,
      firstAlert ? "image" : "alert",
      params,
      isMarket ? process.env.ALL_MARKETPLACE_ALERT_ID : process.env.ALL_MINT_ALERT_ID,
      info.imageUrl
    );

    notify(
      client,
      msg,
      firstAlert ? "image" : "alert",
      params,
      isMarket
        ? process.env.ALL_MARKETPLACE_ALERT_ID_BETA
        : process.env.ALL_MINT_ALERT_ID_BETA,
      info.imageUrl
    );

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

/////////////////////// Discord ///////////////////////////

const client = new Client({ intents: [GatewayIntentBits.Guilds] }); // discord.js handler
client.login(process.env.DISCORD_TOKEN);

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

///////////////////////////////////////////////////////

/////////////////////// Blocknative SDK ///////////////////////////

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

const scanMempool = async () => {
  console.info(`[${new Date().toISOString()}] Starting mempool scan`);

  await updateWalletsInfo(address);

  let count = 0;

  const buffer = 45;

  for (const key in address) {
    let len = address[key].length;
    let id = 0;
    for (let i = 0; i < len; i = i + buffer) {
      const blocknative = new BlocknativeSDK({
        dappId: process.env.BLOCK_KEY,
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

  notify(client, "Wallet Tracker started!", "None", [], process.env.NFT_MINTING_ALERT_ID, "");
  setTimeout(() => setMarketplaceAddresses(), 1000 * 60 * 60 * 48);

  console.log(chalk.red(`\n[${new Date().toISOString()}] Service Start ... `));
};

scanMempool();

///////////////////////////////////////////////////////

const app = express();
const httpServer = http.createServer(app);
httpServer.listen(process.env.PORT, console.log(chalk.yellow(`Start Wallet Tracker...`)));
