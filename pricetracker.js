import { Client, Events, GatewayIntentBits } from "discord.js";

import axios from "axios";
import fetch from "node-fetch";
import fs from "fs";
import data from "./config/config.js";
import { Alchemy, Network } from "alchemy-sdk";

const delay = (ms) => new Promise((res) => setTimeout(res, ms)); // delay time

const alchemy = new Alchemy({
  // Alchemy handler
  apiKey: data.ALCHEMY_API_KEY_PRICE,
  network: Network.ETH_MAINNET,
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] }); // discord.js handler

let priceTracker = JSON.parse(
  fs.readFileSync("./price-tracker.json", "utf-8")
);
let isInit = true;
let limitCount = 0;

const save = (type, obj) => {
  let myJSON = JSON.stringify(obj);
  fs.writeFile(`./${type}.json`, myJSON, (err) => {
    if (err) console.log(err);
    // console.log(`${type} Saved!`);
  });
};

const getContractInfo = async (addr) => {
  try {
    const res = (
      await axios.get(
        `https://eth-mainnet.g.alchemy.com/v2/${data.ALCHEMY_API_KEY_PRICE}/getContractMetadata?contractAddress=${addr}&refreshCache=true`
      )
    ).data.contractMetadata;
    limitCount++;

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
  }
};

const getFloorPrice = async (addr) => {
  try {
    const res = (
      await axios.get(
        `https://eth-mainnet.g.alchemy.com/nft/v2/${data.ALCHEMY_API_KEY_PRICE}/getFloorPrice?contractAddress=${addr}&refreshCache=true`
      )
    ).data;
    limitCount++;
    console.log(limitCount);

    // console.log(res);
    // console.log(res.openSea?.floorPrice);
    return res;
  } catch (e) {
    console.log("Error in getFloorPrice" + e);
  }
};

const getFloorPrices = async (addr) => {
  let price = {};
  try {
    if (addr == undefined || addr.length == undefined) return {};
    console.log(`Get Floor Prices for ${addr.length} addresses`);
    for (let i = 0; addr[i]; i = i + 50) {
      let temp = [];
      for (let j = 0; j < 50; j++) {
        if (!addr[i + j]) break;
        temp.push(
          fetch(
            `https://eth-mainnet.g.alchemy.com/nft/v2/${
              data.ALCHEMY_API_KEY_PRICE
            }/getFloorPrice?contractAddress=${addr[i + j]}&refreshCache=true`
          )
        );
        limitCount++;
      }
      let res = await Promise.all(temp);

      for (const k in res) {
        const response = await res[k].json();
        price[addr[i + parseInt(k)]] = response.openSea?.floorPrice
          ? response.openSea?.floorPrice
          : 0;
      }

      await delay(1500);
    }
    console.log(limitCount);

    return price;
  } catch (e) {
    console.log("Error in getFloorPrices: " + e);
    // await delay(1500);
    // console.log("Retrying...")
    // let price = await getFloorPrices(addr);

    return price;
  }
};

const getNftsForOwner = async (ownerAddress) => {
  try {
    let temp = [],
      pageKey = "",
      res = [];

    do {
      res = (
        await axios.get(
          `https://eth-mainnet.g.alchemy.com/nft/v2/${data.ALCHEMY_API_KEY_PRICE}/getNFTs?owner=${ownerAddress}&pageSize=100&pageKey=${pageKey}&withMetadata=false`
        )
      ).data;
      limitCount++;

      pageKey = res.pageKey;
      res = res.ownedNfts;

      for (const i in res) temp.push(res[i].contract.address);
    } while (res.length == 100);
    console.log(limitCount);

    let nft = {};
    for (const i in temp) nft[temp[i]] = 0;
    temp = [];
    for (const i in nft) temp.push(i);

    return temp;
  } catch (e) {
    console.log("Error in getNftsForOwner: " + e);
    return [];
  }
};

const removeElementFromArray = (arr, element) => {
  let temp = [];
  for (const key in arr) {
    if (arr[key] == element) continue;
    temp.push(arr[key]);
  }
  return temp;
};

const checkFloorPrice = async () => {
  console.log("Check Floor Price");
  setTimeout(async () => await checkFloorPrice(), 1000 * 60 * 120); // sync every 15 min

  let collections = [];
  for (const key in priceTracker.collection) collections.push(key);

  const prices = await getFloorPrices(collections);
  console.log(Object.keys(prices).length);

  if (isInit) {
    isInit = false;

    for (const key in prices)
      if (priceTracker.collection[key]) {
        priceTracker.collection[key].previousPrice = prices[key];
        priceTracker.collection[key].price = prices[key];
        priceTracker.collection[key].buffer = 0;
      }
  } else {
    for (const key in prices) {
      const price = prices[key];
      const userId = priceTracker.collection[key].userId;

      const change = (price / priceTracker.collection[key].price - 1) * 100;
      const previous =
        (price / priceTracker.collection[key].previousPrice - 1) * 100;

      if (change != 0) {
        for (const k in userId) {
          const id = userId[k];
          const percent = priceTracker.info[id].percent;
          let type = 0;
          let previousPrice = 0;

          if (priceTracker.info[id].blackList.indexOf(key) !== -1) continue;

          if (change > percent || -1 * change > percent) {
            type = 1;
            previousPrice = priceTracker.collection[key].price;
          } else if (previous > percent || -1 * previous > percent) {
            type = 2;
            previousPrice = priceTracker.collection[key].previousPrice;
          }

          // console.log(type, id, change, percent, previousPrice, price, priceTracker.info[id].threshold);

          if (
            type &&
            (price - previousPrice >= priceTracker.info[id].threshold ||
              previousPrice - price >= priceTracker.info[id].threshold)
          ) {
            const info = await getContractInfo(key);
            const contractName =
              info.contractName == "#" ? key : info.contractName;

            let msg = `${contractName} just ${
              (type == 2 ? previous : change) > 0 ? "increased" : "decreased"
            } in price by ${(type == 2 ? previous : change).toFixed(0)}%!`;

            let params = [
              {
                name: `Contract Name`,
                value: info.contractName,
                inline: true,
              },
              {
                name: `Links`,
                value: `[Etherscan](https://etherscan.io/address/${key}) ・ [DegenMint](https://catchmint.xyz/?address=${key}) ・ [IcyTools](https://icy.tools/collections/${key}) ・ [NFTFlip](https://review.nftflip.ai/collection/${key}) ・ [NFTNerds](https://app.nftnerds.ai/collection/${key}) ・ [Blur](https://beta.blur.io/collection/${key}) ・ [X2Y2](https://x2y2.io/collection/${key}) ・ [Gem](https://www.gem.xyz/collection/${key}) ・ [TinyAstro](https://tinyastro.io/analytics/${key}) ・ [AlphaSharks](https://vue.alphasharks.io/collection/${key})${
                  info.twitterUsername == "#"
                    ? ""
                    : ` ・ [Twitter](https://twitter.com/${info.twitterUsername})`
                }`,
                inline: false,
              },
              {
                name: `${contractName.toUpperCase()} ${
                  (type == 2 ? previous : change) > 0 ? "+" : ""
                }${(type == 2 ? previous : change).toFixed(
                  0
                )}% (${previousPrice} -> ${price} ETH)`,
                value: `${contractName} has ${
                  (type == 2 ? previous : change) > 0
                    ? "increased"
                    : "decreased"
                } in price from **${previousPrice}->${price} ETH** in the past **${
                  15 * type
                } minutes**!`,
                inline: false,
              },
            ];

            const channel = client.channels.cache.get("1058186894854340698");
            try {
              const member = await client.users.fetch(id);
              member.send({
                content: msg,
                ephemeral: true,
                tts: false,
                embeds: [
                  {
                    type: "rich",
                    color: 0x00ffff,
                    fields: params,
                  },
                ],
              });
            } catch (e) {
              console.log(e);
              channel.send(`<@${id}> didn't enable dm`);
            }

            msg = `<@${id}> - ${contractName} just ${
              (type == 2 ? previous : change) > 0 ? "increased" : "decreased"
            } in price by ${(type == 2 ? previous : change).toFixed(0)}%!`;

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
          }
        }
      }

      priceTracker.collection[key].previousPrice =
        priceTracker.collection[key].price;
      priceTracker.collection[key].price = price;
      priceTracker.collection[key].buffer = change;
    }
  }

  save("price-tracker", priceTracker);
};

const checkNewCollections = async () => {
  console.log("Check New Collections");
  setTimeout(async () => await checkNewCollections(), 1000 * 60 * 60 * 4); // sync every 4 hours

  for (const id in priceTracker.info) {
    const wallet = priceTracker.info[id].wallet;

    // console.log(wallet);

    if (wallet != "") {
      let collections = await getNftsForOwner(wallet);

      // let address = [];
      // for (const i in collections)
      //   if (priceTracker.collection[collections[i]] == undefined)
      //     address.push(collections[i]);
      let prices = await getFloorPrices(collections);

      for (const key in prices) {
        if (priceTracker.collection[key] == undefined)
          priceTracker.collection[key] = {
            userId: [],
            buffer: 0,
            price: 0,
            previousPrice: 0,
          };

        const userId = priceTracker.collection[key].userId;

        if (prices[key] == undefined || prices[key] < 0.01) {
          priceTracker.collection[key].userId = removeElementFromArray(
            priceTracker.collection[key].userId,
            id
          );
          continue;
        }
        if (priceTracker.collection[key].userId.indexOf(id) == -1)
          priceTracker.collection[key].userId.push(id);
        priceTracker.collection[key].price = prices[key];
        priceTracker.collection[key].previousPrice = prices[key];

        // console.log(`${key} is added on collection list - ${prices[key]}`);
      }
    }
    for (const key in priceTracker.info[id].trackList) {
      const addr = priceTracker.info[id].trackList[key].toLowerCase();
      if (priceTracker.collection[addr].userId.indexOf(id) == -1)
        priceTracker.collection[addr].userId.push(id);
    }
  }

  for (const addr in priceTracker.collection)
    if (priceTracker.collection[addr].userId.length == 0)
      delete priceTracker.collection[addr];

  save("price-tracker", priceTracker);
};

const initCommand = async () => {
  try {
    client.application.commands.set([
      {
        name: "wallet",
        description: "Wallet Info",
        type: 1,
        options: [
          {
            name: "wallet_address",
            type: 3,
            description: "address",
            required: true,
          },
        ],
      },
      {
        name: "set",
        description: "Set Percentage",
        type: 1,
        options: [
          {
            name: "percent",
            type: 3,
            description: "Percentage",
            required: true,
          },
        ],
      },
      {
        name: "track",
        description: "to begin tracking a single collection address",
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
      {
        name: "list",
        description: "to display which collection addresses are being tracked",
        type: 1,
        options: [],
      },
      {
        name: "remove",
        description: "to remove a collection address from tracking",
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
      {
        name: "threshold",
        description:
          "The minimum ETH change that can trigger a DM alert. IE:0.02",
        type: 1,
        options: [
          {
            name: "value",
            type: 3,
            description: "minimum-eth-change",
            required: true,
          },
        ],
      },
      {
        name: "settings",
        description: "Users' stat info",
        type: 1,
        options: [
          {
            name: "id",
            type: 3,
            description: "user-id",
            required: true,
          },
        ],
      },
      // {
      //   name: "addm",
      //   description: "Add wallets",
      //   type: 1,
      //   options: [
      //     {
      //       name: "wallet-address",
      //       type: 3,
      //       description: "wallet-address",
      //       required: true
      //     },
      //     {
      //       name: "user-id",
      //       type: 3,
      //       description: "User ID",
      //       required: true
      //     }
      //   ]
      // },
    ]);
    await checkFloorPrice();
    // setTimeout(async () => await checkNewCollections(), 1000 * 60 * 1); // sync after 1 minutes
    await checkNewCollections();
  } catch (e) {
    console.log("Error in initCommand: " + e);
  }
};

client.login(data.PRICEBOT_TOKEN);

client.on("ready", () => {
  console.log("Bot Ready!");
  initCommand();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // if (interaction.commandName === "addm") {
  //   console.log("add: ", interaction.member.user.id);
  //   const wallet = interaction.options.get("wallet-address").value;
  //   const id = interaction.options.get("user-id").value;

  //   // Reply
  //   await interaction.deferReply({ephemeral: true});

  //   if(!priceTracker.info[id])
  //     priceTracker.info[id] = {
  //       wallet: "",
  //       percent: 20,
  //       trackList: [],
  //     }
  //   priceTracker.info[id].wallet = wallet;
  //   let collections = await getNftsForOwner(wallet);
  //   let prices = await getFloorPrices(collections);
  //   // console.log(prices);

  //   let count = 0;
  //   for(const key in collections) {
  //     if(!prices[collections[key]] || prices[collections[key]]<0.01) continue;
  //     count ++;
  //     if(priceTracker.collection[collections[key]] == undefined)
  //       priceTracker.collection[collections[key]] = {
  //         userId: [],
  //         buffer: 0,
  //         price: 0,
  //       }
  //     if(priceTracker.collection[collections[key]].userId.indexOf(id) == -1)
  //       priceTracker.collection[collections[key]].userId.push(id);
  //     priceTracker.collection[collections[key]].price = prices[collections[key]];
  //   }

  //   let msg = "Howdy! Let's take a look at this here wallet...";
  //   let params = [{
  //   name: `\u200B`,
  //   value: "Next you want to ` /set` the %change difference we should monitor for floor price changes of your watched collections.\n",
  //   inline: true,
  //   }]

  //   await interaction.editReply({
  //   content: msg,
  //   ephemeral: true,
  //   tts: false,
  //   embeds: [
  //     {
  //     type: "rich",
  //     "title": `Wallet ${wallet}`,
  //     "description": `You're holding **${collections.length}** collections.\n**${count}** of your collections qualify for tracking.`,
  //     color: 0x00ffff,
  //     fields: params,
  //     },
  //   ],
  //   ephemeral: true,
  //   });

  //   save("price-tracker", priceTracker)
  // }
  if (interaction.commandName === "wallet") {
    const wallet = interaction.options.get("wallet_address").value;
    const id = interaction.user.id;

    // Reply
    await interaction.deferReply({ ephemeral: true });

    if (!priceTracker.info[id])
      priceTracker.info[id] = {
        wallet: "",
        percent: 20,
        trackList: [],
        blackList: [],
        threshold: 0.02,
      };
    priceTracker.info[id].wallet = wallet;
    let collections = await getNftsForOwner(wallet);
    let prices = await getFloorPrices(collections);

    let count = 0;
    for (const key in collections) {
      if (!prices[collections[key]] || prices[collections[key]] < 0.01)
        continue;
      count++;
      if (priceTracker.collection[collections[key]] == undefined)
        priceTracker.collection[collections[key]] = {
          userId: [],
          buffer: 0,
          price: 0,
          previousPrice: 0,
        };
      if (priceTracker.collection[collections[key]].userId.indexOf(id) == -1)
        priceTracker.collection[collections[key]].userId.push(id);
      priceTracker.collection[collections[key]].price =
        prices[collections[key]];
    }

    let msg = "Howdy! Let's take a look at this here wallet...";
    let params = [
      {
        name: `\u200B`,
        value:
          "Next you want to ` /set` the %change difference we should monitor for floor price changes of your watched collections.\n",
        inline: true,
      },
    ];

    await interaction.editReply({
      content: msg,
      ephemeral: true,
      tts: false,
      embeds: [
        {
          type: "rich",
          title: `Wallet ${wallet}`,
          description: `You're holding **${collections.length}** collections.\n**${count}** of your collections qualify for tracking.`,
          color: 0x00ffff,
          fields: params,
        },
      ],
      ephemeral: true,
    });

    save("price-tracker", priceTracker);
  }
  if (interaction.commandName === "set") {
    const percent = parseInt(interaction.options.get("percent").value);
    const id = interaction.user.id;

    if (priceTracker.info[id] == undefined) {
      await interaction.reply({
        content: "Please add your wallet address first - ` /wallet`",
        ephemeral: true,
      });
      return;
    }
    priceTracker.info[id].percent = percent;

    // Reply
    let msg = "Your watch alert percentage is set!";
    let params = [
      {
        name: `\u200B`,
        value: `That means you'll be alerted when there is a **${percent}% floor price change** within 15/30 minutes for any of your watched collections\n`,
        inline: true,
      },
      {
        name: "Enable Direct Message!",
        value:
          "Price Tracker needs you to allow dms from server. Please check your discord",
        inline: false,
      },
    ];

    await interaction.reply({
      content: msg,
      ephemeral: true,
      tts: false,
      embeds: [
        {
          type: "rich",
          title: `Wallet ${priceTracker.info[id].wallet}`,
          description: `You just set the watch alerts for **${percent}%**`,
          color: 0x00ffff,
          fields: params,
        },
      ],
      ephemeral: true,
    });

    save("price-tracker", priceTracker);
  }
  if (interaction.commandName === "track") {
    const address = interaction.options
      .get("collection-address")
      .value.toLowerCase();
    const id = interaction.user.id;

    await interaction.deferReply({ ephemeral: true });

    if (!priceTracker.info[id])
      priceTracker.info[id] = {
        wallet: "",
        percent: 20,
        trackList: [],
        blackList: [],
        threshold: 0.02,
      };
    if (priceTracker.collection[address] == undefined)
      priceTracker.collection[address] = {
        userId: [],
        buffer: 0,
        price: 0,
        previousPrice: 0,
      };
    priceTracker.collection[address].price = (
      await getFloorPrice(address)
    ).openSea?.floorPrice;
    if (priceTracker.collection[address].userId.indexOf(id) == -1)
      priceTracker.collection[address].userId.push(id);

    if (priceTracker.info[id].trackList.indexOf(address) == -1)
      priceTracker.info[id].trackList.push(address);

    await interaction.editReply({
      content: `${address} has added to tracker list`,
      ephemeral: true,
    });
    save("price-tracker", priceTracker);
  }
  if (interaction.commandName === "list") {
    const id = interaction.user.id;
    if (!priceTracker.info[id])
      priceTracker.info[id] = {
        wallet: "",
        percent: 20,
        trackList: [],
        blackList: [],
        threshold: 0.02,
      };
    const wallet = priceTracker.info[id].wallet;

    let msg = `Hey ${wallet}, here's what you're tracking`;
    let params = [];

    for (const key in priceTracker.info[id].trackList) {
      const address = priceTracker.info[id].trackList[key];
      const collection = priceTracker.collection[address];

      const info = await getContractInfo(address);
      params.push({
        name: `${info.contractName} [${
          collection.price
        }] (${collection.buffer.toFixed(0)}%)`,
        value: `**${address}**`,
        inline: false,
      });
    }

    await interaction.reply({
      content: msg,
      ephemeral: true,
      tts: false,
      embeds: [
        {
          type: "rich",
          title: `Tracked Collections For ${wallet}`,
          description:
            "Here are the collections you are tracking, and their recent movements.",
          color: 0x00ffff,
          fields: params,
        },
      ],
      ephemeral: true,
    });
  }
  if (interaction.commandName === "remove") {
    let address = interaction.options
      .get("collection-address")
      .value.toLowerCase();
    // console.log(interaction);
    const id = interaction.user.id;

    if (priceTracker.info[id].blackList.indexOf(address) == -1)
      priceTracker.info[id].blackList.push(address);

    await interaction.reply({
      content: `You are no longer tracking ${address}`,
      ephemeral: true,
    });
    save("price-tracker", priceTracker);
  }
  if (interaction.commandName === "threshold") {
    let value = parseFloat(interaction.options.get("value").value);
    const id = interaction.user.id;

    priceTracker.info[id].threshold = value;

    await interaction.reply({
      content: `Threshold set to ${value}`,
      ephemeral: true,
    });
    save("price-tracker", priceTracker);
  }
  if (interaction.commandName === "settings") {
    let id = interaction.options.get("id").value;
    const userId = interaction.user.id;

    if (userId == "337699677837459456" || userId == "1044425953436250199") {
      const info = priceTracker.info[id];

      if (info == undefined) {
        await interaction.reply({
          content: `Wrong user id!`,
          ephemeral: true,
        });
      }

      let count = 0;
      for (const key in priceTracker.collection)
        if (priceTracker.collection[key].userId.indexOf(id) != -1) count++;

      let params = [
        {
          name: `Percent`,
          value: `${info.percent}%`,
          inline: true,
        },
        {
          name: `Threshold`,
          value: `${info.threshold} ETH`,
          inline: true,
        },
        {
          name: `Tracked Collections`,
          value: `${count}`,
          inline: true,
        },
      ];
      await interaction.reply({
        content: "",
        ephemeral: true,
        tts: false,
        embeds: [
          {
            type: "rich",
            title: `Your Stats`,
            description: `Stats for ${info.wallet}`,
            color: 0x00ffff,
            fields: params,
          },
        ],
      });
    } else {
      await interaction.reply({
        content: `You're not able to use this command`,
        ephemeral: true,
      });
    }
  }
  // if (interaction.commandName === "watch") {
  //   let address = interaction.options.get("contract-address").value;
  //   let percent = interaction.options.get("percent-change").value;

  //   console.log(address, percent);
  // }
});
