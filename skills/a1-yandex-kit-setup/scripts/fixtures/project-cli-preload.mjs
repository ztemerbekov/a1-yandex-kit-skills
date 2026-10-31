import net from 'node:net';
import { EventEmitter } from 'node:events';
import './project-fetch.mjs';
const connect = net.connect;
net.connect = (options, ...args) => {
    if (options && ['registry.npmjs.org', 'api.kit.yandex.net'].includes(options.host)) {
        const socket = new EventEmitter();
        socket.destroy = () => { };
        queueMicrotask(() => socket.emit('connect'));
        return socket;
    }
    return connect(options, ...args);
};
