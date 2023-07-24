/*****************************************************************************************************
 * Check Functions
 * ***************************************************************************************************/

export const checkMethodId = (input) => {
  const methodid = input.slice(0, 10).toLowerCase();
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

export const isBlackList = (addr, blacklists) => {
  for (const key in blacklists)
    if (blacklists[key].toLowerCase() == addr.toLowerCase()) return true;
  return false;
};

export const isMarkets = (addr, markets) => {
  for (const key in markets)
    if (markets[key].toLowerCase() == addr.toLowerCase()) return true;
  return false;
};

export const inOurList = (owners, address) => {
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