const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

class WebServer {
    constructor() {
        this.app = express();
        this.http = http.createServer(this.app);

        this.io = new Server(this.http, {
            cors: { origin: '*' }
        });

        this.setup();
    }

    setup() {
        this.app.use(express.static('public'));

        this.app.get('/', (req, res) => {
            res.sendFile(path.join(process.cwd(), 'public/index.html'));
        });

        this.app.get('/health', (req, res) => {
            res.status(200).send('OK');
        });
    }

    start() {
        return new Promise(resolve => {
            const port = process.env.PORT || 3000;

            this.http.listen(port, () => {
                console.log(`Server running on ${port}`);
                resolve();
            });
        });
    }

    stop() {
        return new Promise(resolve => {
            this.http.close(() => resolve());
        });
    }
}

module.exports = WebServer;
