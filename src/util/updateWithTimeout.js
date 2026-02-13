import { sleep } from "./sleep.js";

export async function updateWithTimeout(base, ms = 500, label = "update") {
    const timeoutErr = new Error(`${label} timeout after ${ms}ms`);
    timeoutErr.code = "ERR_UPDATE_TIMEOUT";
    let timer;
    try {
        await Promise.race([
            base.update({ wait: true }).then(() => sleep(0)),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(timeoutErr), ms);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
