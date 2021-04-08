import * as dotenv from 'dotenv';
import * as Discord from 'discord.js';
import assert from 'assert';
import { PlayerManager } from 'discord.js-lavalink';

import { CommandEmitter } from './command/emitter';
import * as core from './command/core';
import { DB } from './db';
//import MongoPoweredDB from './db/mongo';
import JSONPoweredDB from './db/json';
import { LavaManager } from './services/lava';
import ConfigManager from './config';
import MusicPlayerService from './services/music';
import LinkerService from './services/linker';
import { SpotifyUser, SpotifyWebHelper } from './services/spotify/user';
import { SpotifyPlayer } from './services/spotify/player';

const _env = dotenv.config().parsed;

console.debug = (...data: any[]) => {
    if (process.env.NODE_ENV !== 'development') return;
    console.log(`[DEBUG]`, ...data);
}

if (process.env.NODE_ENV === 'development') {
    Object.keys(_env).forEach((k) => {
        console.debug(`[ENV] ${k}=${_env[k]}`);
    })
}

const conf = new ConfigManager();

if (conf.getDirty()) {
    console.error("[FATAL] A dirty (or nonexistant) config.json file was found, please generate a new one");
    assert(false, conf.getDirty());
}

const client = new Discord.Client();
const dbEngine: DB = new JSONPoweredDB();
const cmdEmitter = new CommandEmitter(conf, dbEngine);
const musicService = new MusicPlayerService(conf, client, dbEngine);
const linkerService = new LinkerService();

client.on('ready', async () => {

    // Add command handlers
    cmdEmitter.addCommandHandler('link', core.link);
    cmdEmitter.addCommandHandler('unlink', core.unlink);
    cmdEmitter.addCommandHandler('rename', core.rename, 'name');
    cmdEmitter.addCommandHandler('help', core.help, 'h');

    console.log(`[INFO] Discord ready, starting Lavalink initialization...`);

    const nodes = [{ host: 'localhost', port: 2333, password: '12345' }];

    const manager = new LavaManager(client, nodes, {
        user: client.user.id,
        shards: 1
    });

    let lavaReady = false;

    manager.on('ready', async () => {
        lavaReady = true;

    
        console.log(`[INFO] Lavalink initialized, starting Spotify initialization...`);

        // I have not yet figured out a way to validate the client id and client secret without 
        //  performing a oauth authorization grant, so this function won't check if these parameters are valid
        musicService.initialize(manager);
        SpotifyWebHelper.init(dbEngine, conf.get('spotify_client_id'), conf.get('spotify_client_secret'));

        console.log(`[INFO] Initialization completed`);

        const player = await musicService.joinChannel('790885090808299542', '798646281718333461');

        

        /*const demoUser = new SpotifyUser('389786424142200835', dbEngine, conf.get('spotify_client_id'), conf.get('spotify_client_secret'));

        demoUser.on('volume', (volume) => {
            console.log(`[DEMO] volume = ${volume}`);
        });

        demoUser.on('playback-lost', (e) => {
            console.log(`[DEMO] playback-lost`);
        });

        demoUser.on('playback-update-pre', () => {
            console.log(`[DEMO] playback-update-pre`);
        });

        demoUser.on('pause-playback', (e) => {
            console.log(`[DEMO] pause-playback = ${e.paused}`)
        });

        demoUser.on('seek-playback', (e) => {
            console.log(`[DEMO] seek-playback = ${e.position}`);
        });

        demoUser.on('modify-playback', () => {
            console.log(`[DEMO] modify-playback`);
        });

        demoUser.on('play-track', (e) => {
            console.log(`[DEMO] play-track = paused = ${e.paused}, position = ${e.position}`);
        });

        demoUser.on('unknown', (p) => {
            console.log(`[DEMO] unknown`);
            console.log(p);
        });

        await demoUser.initialize();*/
    });

    manager.on('error', (e) => {
        if (!lavaReady) {
            console.error(`[FATAL] Lavalink Initialization failed`);
            
            client.destroy();
            process.exit(-1);
        }

        console.error('Lavalink error: ', e);
    });
});

client.on('guildCreate', (guild) => {
    console.log(`[INFO] Joined guild "${guild.name}"`);
});

client.on('guildDelete', (guild) => {
    console.log(`[INFO] Left guild "${guild.name}"`);
});

client.on('message', (msg) => {
    if (!msg.guild) return;
    if (!msg.content.startsWith(conf.get('prefix'))) return;

    const args = msg.content.substr(1).split(' ');
    const cmd = args.shift().toLowerCase();

    console.debug(`[CMD] ${cmd} -> ${args.map(a => `"${a}"`).join(' ')}`)

    cmdEmitter.emit(cmd, args, msg);
});

dbEngine.initialize().then((success) => {
    if (!success) {
        console.error(`[FATAL] DB Initialization failed`);
        process.exit(-1);
    }

    console.log(`[INFO] Database initialized, starting Linking service...`);

    linkerService.initialize(conf, dbEngine).then((success) => {
        if (!success) {
            console.error(`[FATAL] Linking service initialization failed`);
            process.exit(-1);
        }

        console.log(`[INFO] Linker service initialized, starting Discord initialization...`);

        client.login(conf.get('token'));
    });
});