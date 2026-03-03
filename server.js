const http   = require('node:http');
const fs     = require('node:fs');
const crypto = require("crypto");
const { spawn } = require('node:child_process');

const safeEq = (a,b) => {
  [a,b] = [a,b].map(x=>Buffer.from(x));
  if(a.length !== b.length) return false;
  return crypto.timingSafeEqual(a,b);
}
const generateRandomString = (myLength) => { // https://www.kindacode.com/article/how-to-easily-generate-a-random-string-in-node-js
  const chars = "AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz1234567890";
  const randomArray = Array.from({ length: myLength },
                                 (v,k) => chars[Math.floor(Math.random() * chars.length)]);
  return randomArray.join("");
};
dbg = x => console.log("dbg: ",x) || x;
serverResponse = (res, result, type, msg) => (res.writeHead(result, { "Content-Type": type }), res.end(msg));
checkEndpoint = ([req,res], name, auth, cb) => {
  if(!req.url.startsWith(`/${name}/`)) return;
  let body = [];
  req.on('data', (chunk) => {
    body.push(chunk);
  }).on('end', () => {
    body = Buffer.concat(body).toString();
    let j = body.length ?JSON.parse(body): undefined;
    if(auth && !(j && j.password && safeEq(j.password,process.env.UPLOAD_PASS)))
      return serverResponse(res, 400, "text/plain", "Try Again");
    let q = decodeURI(req.url.replace(new RegExp(`^${RegExp.escape(`/${name}/`)}`),""));
    cb(q,j,(code,data) => {
      let ct = typeof data === "string" ?"text/plain": "application/json";
      if(typeof data !== "string") data = JSON.stringify(data);
      serverResponse(res, code, ct, data);
    });
  });
  return true;
};

const audioListing = [];
let nameExtractRegex = /^(.*) \[[a-zA-Z0-9\-_]{8,12}\]\.[a-z0-9]+$/;
let extExtractRegex  = /^.*\.([a-z0-9]{3,4})$/;
let addSong = (filePath) => {
  let song = {name:filePath.match(nameExtractRegex)[1], url:encodeURI(`audios/${filePath}`)};
  if(!audioListing.some(x => x.name == song.name)) audioListing.push(song);
  return song;
};
fs.readdir('./audios', (err, files) => {
  if(err) throw err;
  files.map(addSong);
});

let downloadSong = url => {
  let foldName = `./tempFiles/${generateRandomString(12)}`;
  fs.mkdirSync(foldName);
  return new Promise((res,rej) => {
    const proc = spawn("yt-dlp",["--audio-format","mp3","-x",url], {cwd: foldName});
    proc.on("close", C => {
      dbg(C);
      fs.readdir(foldName, (err, files) => {
        if(!files.length) {
          rej("Unable to Download!");
          return; 
        }
        let file = files[0];
        fs.renameSync(`${foldName}/${file}`, `./audios/${file}`);
        fs.rmdirSync(foldName);
        res(addSong(file));
      });
    });
  });
};
let deleteSong = name => {
  let i = audioListing.findIndex(x => x.name == name);
  if(i == -1) throw "Song Not Found";
  let songUrl = audioListing[i].url;
  audioListing.splice(i, 1);
  return fs.unlink(decodeURI(songUrl), ()=>0);
};
const server = http.createServer((req, res) => {
  dbg(req.url);
  let P = [req,res];
  if(req.url.startsWith("/audios/")) {
    let a = decodeURI(req.url.replace(/^\/audios\//,""));
    return fs.readFile(`audios/${a}`, (err, data) => {
      if(err) return console.error(err);
      let contentType = { opus: 'audio/opus', m4a: 'audio/mp4', mp3: 'audio/mp3'}[a.match(extExtractRegex)[1]];
      serverResponse(res, 200, contentType, data);
    });
  }
  if(checkEndpoint(P, "search", false, (q,j,cb) => {
    let s = RegExp.escape(q.toLowerCase());
    cb(200,audioListing.filter(x => x.name.toLowerCase().search(s) != -1));
  })) return;
  if(checkEndpoint(P, "unlock", true, (q,j,cb) => 
       cb(200,"👍"))) return;
  if(checkEndpoint(P, "upload", true, (q,j,cb) => 
       downloadSong(j.url).then(song => cb(200,song))
                          .catch(e => cb(400,"Downloader Error")))) return;
  if(checkEndpoint(P, "deleteSong", true, (q,j,cb) => {
      try {
        deleteSong(j.name);
        cb(200,"👍");
      }catch(e) { cb(400,"Error Deleting File"); }
  })) return;
  fs.readFile('index.html', 'utf8', (err, data) => serverResponse(res, 200, "text/html", data));
});
process.on('unhandledRejection', err => {
  console.error('Unhandled rejection:', err);
});
server.listen(80);