const notify = (client, msg, type, params, channelId, img) => {
    const channel = client.channels.cache.get(channelId);
    if (type == "alert" || img == "#")
      channel.send({
        content: msg,
        tts: false,
        embeds: [
          {
            type: "rich",
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

export default notify;