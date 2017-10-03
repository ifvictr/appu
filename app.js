const base62 = require("base62");
const base64 = require("base-64");
const express = require("express");
const github = require("github");
const helmet = require("helmet");
const mime = require("mime");
const multer = require("multer");
const path = require("path");

const app = express();
const client = github();
const upload = multer();

app.set("port", process.env.PORT || 3000);
app.use(express.static(path.join(__dirname, "public")));
app.use(helmet());

// Authenticate with GitHub
client.authenticate({
    type: "token",
    token: process.env.GITHUB_TOKEN
});

app.post("/upload", upload.array("images"), async (req, res) => {
    if(!req.files) {
        res.status(400).json({message: "`images` parameter was empty"});
        return;
    }

    let index = 0;
    try {
        index = (await client.repos.getContent({
            owner: process.env.GITHUB_USER,
            repo: process.env.GITHUB_REPO,
            path: ".appu"
        })).data.content;
        index = base64.decode(index);
        index = parseInt(base62.decode(index), 10);
    }
    catch(err) {
        index = -1;
    }

    const files = [];
    for(const file of req.files) {
        const ext = mime.getExtension(file.mimetype);
        // Skip the file if it isn't an image
        if("gif|ico|jpeg|png".indexOf(ext) === -1) {
            continue;
        }
        files.push({
            path: `${base62.encode(++index)}.${ext}`,
            content: new Buffer(file.buffer).toString("base64"),
            encoding: "base64"
        });
    }
    // Finish early if there were no successful files
    if(files.length === 0) {
        res.status(400).json({message: "Uploaded file(s) failed to meet mime type requirements"});
        return;
    }

    // Update the file with the new index
    files.push({
        path: ".appu",
        content: base62.encode(index),
        encoding: "utf-8"
    });
    try {
        const blobs = await Promise.all(files.map(file => {
            return client.gitdata.createBlob({
                owner: process.env.GITHUB_USER,
                repo: process.env.GITHUB_REPO,
                content: file.content,
                encoding: file.encoding
            });
        }));

        const head = await client.gitdata.getReference({
            owner: process.env.GITHUB_USER,
            repo: process.env.GITHUB_REPO,
            ref: "heads/master"
        });

        const tree = await client.gitdata.getTree({
            owner: process.env.GITHUB_USER,
            repo: process.env.GITHUB_REPO,
            sha: head.data.object.sha
        });

        const createdTree = await client.gitdata.createTree({
            owner: process.env.GITHUB_USER,
            repo: process.env.GITHUB_REPO,
            tree: files.map((file, i) => {
                return {
                    path: file.path,
                    mode: "100644",
                    type: "blob",
                    sha: blobs[i].data.sha
                };
            }),
            base_tree: tree.data.sha
        });

        const commit = await client.gitdata.createCommit({
            owner: process.env.GITHUB_USER,
            repo: process.env.GITHUB_REPO,
            message: "Add new images",
            tree: createdTree.data.sha,
            parents: [head.data.object.sha]
        });

        await client.gitdata.updateReference({
            owner: process.env.GITHUB_USER,
            repo: process.env.GITHUB_REPO,
            ref: "heads/master",
            sha: commit.data.sha
        });

        // TODO: Return link to the image on success
        res.status(201).json(files);
    }
    catch(err) {
        res.status(500).json({message: err.message});
    }
});

app.listen(app.get("port"), () => {
    console.log(`Listening on port ${app.get("port")}`);
});