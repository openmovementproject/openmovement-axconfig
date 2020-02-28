// Async sleep for milliseconds
export async function sleep(msec) {
    return new Promise(resolve => setTimeout(resolve, msec));
}

export function localTimeString(date, minutes) {
    if (typeof date !== 'object') return null;
    const tzOffset = (new Date()).getTimezoneOffset() * 60 * 1000;
    const local = (new Date(date.getTime() - tzOffset)).toISOString().slice(0, -1);
    if (minutes) return local.slice(0, -7);
    return local;
}

export function localTimeValue(str) {
    if (typeof str !== 'string' || str.length === 0) return null;
    if (str.length == 16) str += ':00';
    if (str.length == 19) str += '.000';
    if (str.length == 23) str += 'Z';
    const tzOffset = (new Date()).getTimezoneOffset() * 60 * 1000;
    const local = (new Date((new Date(str)).getTime() + tzOffset));
    return local;
}


// Retrieve page address parameters and watch for (non-reload) hash parameter changes
export function watchParameters(callback) {

    function hashchange() {
        const url = new URL(window.location.href);
        const searchParams = url.searchParams;
        const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    
        // List of all keys/values in order, including duplicates
        const paramList = [];
        for (let urlSearchParams of [searchParams, hashParams]) {
            for (let paramKeyValue of urlSearchParams.entries()) {
                paramList.push(paramKeyValue);
            }
        }
        //console.log('PARAM-LIST: ' + JSON.stringify(paramList));
    
        // Object representation, lowercase keys, duplicates replace previous
        const params = {};
        for (let paramKeyValue of paramList) {
            params[paramKeyValue[0].toLowerCase()] = paramKeyValue[1];
        }
        //console.log('PARAMS: ' + JSON.stringify(params));
    
        callback(params, paramList);
    }

	window.onhashchange = hashchange;
	hashchange();
}


// Intercept console writes to append to page element - safe to call before DOM loaded
export function redirectConsole(selector, newElement = 'P') {

    function log(selector, category, ...message) {
        const elem = document.querySelector(selector);
        const msg = message.join(' ');
        if (!elem) {
            return '[pre-DOM] ' + msg;
        }
        const textnode = document.createTextNode(msg);
        const node = document.createElement(newElement);
        node.appendChild(textnode);
        elem.appendChild(node);
        node.scrollIntoView(false);
        return msg;
    }

    for (let category of ['log', 'warn', 'error']) {
        const original = console[category];
        console[category] = function() {
            const response = log(selector, category, ...arguments);
            original(response);
        }
    }
}
