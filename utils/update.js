import { getMultipleStatInfo, getCollectWalletInfo, getContractInfo, getFloorPrice, getCollectionUrl } from "./api.js";
import save from './save.js'
import { inOurList } from './check.js'
import { Alchemy, Network } from "alchemy-sdk";
import dotenv  from "dotenv"
import fs from 'fs'
dotenv.config()


export const updateWalletsInfo = async (address) => {
    try {
        var stats = JSON.parse(fs.readFileSync("./config/stats.json", "utf-8"));
        let count = 0;

        for (const i in address) {
            const responses = await getMultipleStatInfo(address[i], stats);

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
  
export const updateStats = async (addr) => {
    try {
        var stats = JSON.parse(fs.readFileSync("./config/stats.json", "utf-8"));

        const wallets = await getCollectWalletInfo(addr);
        const responses = await getMultipleStatInfo(wallets, stats);

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


export const getAlertCountFromContract = (contractAddress, addr) => {
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

export const alertCollection = async (address, type) => {
    try {
        const alchemy = new Alchemy({
            apiKey: process.env.ALCHEMY_API_KEY_WALLET,
            network: Network.ETH_MAINNET,
        });
        var stats = JSON.parse(fs.readFileSync("./config/stats.json", "utf-8"));

        const info = await getContractInfo(address);
        const addr = await updateStats(address);

        // FloorPrice
        let floorPrice = await getFloorPrice(address);

        // TotalSupply
        let tokens = (await getContractInfo(address))?.totalSupply;

        // Get owners
        const owners = (await alchemy.nft.getOwnersForContract(address)).owners;
        global.limitCount++;
        console.log(global.limitCount);
        let wallets = [];

        if (type == "full") {
        wallets = owners;
        } else if (type == "list") {
        wallets = inOurList(owners, address);
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