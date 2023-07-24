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