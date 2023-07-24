export const getFloorPrice = async (addr) => {
    try {
      const res = (
        await axios.get(
          `https://eth-mainnet.g.alchemy.com/nft/v2/${process.env.ALCHEMY_API_KEY_WALLET}/getFloorPrice?contractAddress=${addr}&refreshCache=true`
        )
      ).data;
      global.limitCount++;
      console.log(global.limitCount);
  
      return res.openSea?.floorPrice;
    } catch (e) {
      console.log("Error in getFloorPrice" + e);
    }
};


export const getContractInfo = async (addr) => {
  try {
    const res = (
      await axios.get(
        `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY_WALLET}/getContractMetadata?contractAddress=${addr}&refreshCache=true`
      )
    ).data.contractMetadata;
    global.limitCount++;
    console.log(global.limitCount);

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

export const getTokenInfo = async (addr, hash) => {
  try {
    console.info(`[${new Date().toISOString()}] Get Token Info`);

    let options = {
      method: "POST",
      url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY_WALLET}`,
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
    global.limitCount++;
    console.log(`[${new Date().toISOString()}] Limit count: ${global.limitCount}`);

    for (const key in res) {
      if (res[key].hash == hash) return res[key].rawContract.address;
    }

    options = {
      method: "POST",
      url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY_WALLET}`,
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
    global.limitCount++;
    console.log(`[${new Date().toISOString()}] Limit count: ${global.limitCount}`);

    for (const key in res) {
      if (res[key].hash == hash) return res[key].rawContract.address;
    }

    return null;
  } catch (e) {
    console.error(`[${new Date().toISOString()}] Error in getTokenInfo: `, e);
  }
};