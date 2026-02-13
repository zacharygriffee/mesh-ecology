import {sleep} from "./util/sleep.js";

async function getWait(subject, key, config = {}) {
    const {
        getter = async (subject, key, config = {}, retryLeft) => subject.get(key, config),
        interval = 0,
        tries = 64,
        first = 0,
        sleep: _sleep = (i, n) => sleep(i),
        predicate = (val) => val != null,
        ...rest
    } = config;

    let triesLeft = tries;
    if (first > 0) await _sleep(first,triesLeft);
    while (triesLeft--) {
        const val = await getter(subject, key, rest, triesLeft);
        if (predicate(val)) return val;
        await _sleep(interval,triesLeft);
    }

    throw Object.assign(new Error(`getWait timeout: key=${key}`), {
        code: "ERR_GETWAIT_TIMEOUT",
        key,
        tries,
        interval
    });
}


export {getWait};