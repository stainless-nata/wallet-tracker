import fs from "fs";

const save = (type, obj) => {
    let myJSON = JSON.stringify(obj);
    fs.writeFile(`./config/${type}.json`, myJSON, (err) => {
      if (err) console.log(err);
      // console.log(`${type} Saved!`);
    });
};

export default save;