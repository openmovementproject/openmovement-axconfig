// Form for input details
// Save config to localstorage?
// Check battery and configuration status?
// Barcode/QR-code read?
// Save log to localstorage (and sync)?

// Extract last 9 digits:
//   parseInt('0' + id.replace(/[^0-9]/g, '').slice(-9))
//
// Extract last 9 alphanumeric characters convert non-numeric to '0':
//   parseInt('0' + id.replace(/[^A-Za-z0-9]/g, '').replace(/[^0-9]/g, '0').slice(-9))

/*
Linux: USB devices typically read-only for non-root users.

Add a new udev rule by creating a file at `/etc/udev/rules.d/07-cwa.rules`:

```bash
SUBSYSTEM=="usb", ATTR{idVendor}=="04d8", ATTR{idProduct}=="0057", MODE="0664", GROUP="plugdev"
```

Add the user to the `plugdev` group: `sudo adduser pi plugdev`

# /lib/udev/rules.d/60-serial.rules
# ls /dev/serial/by-id

#sudo udevadm control --reload-rules && udevadm trigger
#lsusb -v -d 04d8:0057


# chromium-browser --disable-webusb-security
*/
/*
// Windows Chrome WebUSB Back-end:  chrome://flags/#new-usb-backend
*/

import { redirectConsole, watchParameters, localTimeString, localTimeValue } from './util.mjs';
import KeyInput from './key_input.mjs';
import DeviceManager from './device_manager.mjs';
//import Barcode from './barcode.mjs';

window.addEventListener("error", function (e) {
    document.getElementById('warnings').appendChild(document.createTextNode('⚠️ Unhandled error.'));
    console.error("ERROR: Unhandled error: " + (e.error && e.error.message ? e.error.message : e.error));
    console.error(JSON.stringify(e));
    return false;
});

window.addEventListener("unhandledrejection", function (e) {
    document.getElementById('warnings').appendChild(document.createTextNode('⚠️ Unhandled promise rejection.'));
    console.error("ERROR: Unhandled rejection: " + (e.error && e.error.message ? e.error.message : e.error));
    console.error(JSON.stringify(e));
    return false;
});


redirectConsole('#output');

let currentDevice = null;
let startRelative = null;
let lastConfig = {};

const RELATIVE_CUTOFF = 946684800 * 1000;   // 2000-01-01 (treat as relative time if smaller than this)

window.addEventListener('DOMContentLoaded', async (event) => {
    const deviceManager = new DeviceManager();

    for (let warning of deviceManager.warnings) {
        document.getElementById('warnings').appendChild(document.createTextNode('⚠️ ' + warning));
    }

    const codeInput = '#code';

    const updateEnabled = () => {
        //const code = document.querySelector(codeInput).value;

        let config = null;
        try {
            config = configFromForm();
            //console.log(JSON.stringify(config, null, 4));
            setResult('', false);
        } catch (e) {
            //console.log('CONFIGURATION: ' + e);
            setResult(e, true);
        }

        const enabled = config && !!currentDevice; // && code.length > 0
        keyInput.submitEnabled(enabled);
    }

    const updateStatus = () => {
        let status = {
            deviceId: '-',
            battery: '-',
            state: null,
            errorState: null,
        };

        currentDevice = deviceManager.getSingleDevice();
        if (currentDevice) {
            status.deviceId = currentDevice.serial;
            if (currentDevice.status.battery !== null) {
                status.battery = currentDevice.status.battery.percent;
            }
            status.state = currentDevice.status.state;
            status.errorState = currentDevice.status.errorState;

            document.querySelector('body').classList.add('device-connected');
        } else {
            document.querySelector('body').classList.remove('device-connected');
        }

        document.querySelector('#device-id').value = status.deviceId;
        document.querySelector('#battery-meter').value = Number.isNaN(parseInt(status.battery)) ? 0 : parseInt(status.battery);
        document.querySelector('#battery').value = Number.isNaN(parseInt(status.battery)) ? '-' : status.battery + "%";
        document.querySelector('#state').value = status.state || status.errorState || '-';

        updateEnabled();
    }

    const deviceChanged = async () => {
        currentDevice = deviceManager.getSingleDevice();
        if (!currentDevice) {
            console.log('DEVICECHANGED: (none)');
            updateStatus();
        } else {
            console.log('DEVICECHANGED: ' + currentDevice.serial);
            currentDevice.setStatusHandler(updateStatus);
            console.log('DEVICECHANGED: updateStatus...');
            await currentDevice.updateStatus();
            console.log('STATUS: ' + JSON.stringify(currentDevice.status));
            //updateStatus();
        }
    }

    const parseDate = (time) => {
        if (!time && time !== 0) return null;
        if (time && Object.prototype.toString.call(time) === "[object Date]" && !isNaN(time)) {
            return time;
        }
        if (/\d\d\d\d-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d\d\d)?Z?/.test(time)) {
            try {
                return new Date(time);
            } catch (e) {
                console.error('ERROR: Problem parsing date: ' + time);
            }
        }
        return null;
    }

    const relativeTime = (time, relativeTo, unitScale = 60 * 60 * 1000) => {
        if (!time && time !== 0) return null;
        const date = parseDate(time);
        if (date) {
            return date;
        }
        relativeTo = (!relativeTo && relativeTo !== 0) ? (new Date()) : relativeTo;
        return new Date(relativeTo.getTime() + parseFloat(time) * unitScale);
    }

    const updateForm = (config) => {
        document.querySelector('#session').value = typeof config.session !== 'undefined' ? config.session : '';
        document.querySelector('#rate').value = typeof config.rate !== 'undefined' ? config.rate : '';
        document.querySelector('#range').value = typeof config.range !== 'undefined' ? config.range : '';

        let now = new Date();
        let start = relativeTime(config.start, now);
        if (start === null) {
            start = now;
        }
        document.querySelector('#start').value = localTimeString(start, true) || '';
        let stop = relativeTime(config.stop, start);
        if (stop === null) {
            stop = now;
        }
        document.querySelector('#stop').value = localTimeString(stop, true) || '';
        stopChanged();
        //durationChanged(0);

        document.querySelector('#metadata').value = typeof config.metadata !== 'undefined' ? config.metadata : '';
        updateEnabled();
    }

    const getDuration = () => {
        if (document.querySelector('#duration').value === '') return null;
        const hours = parseFloat(document.querySelector('#duration').value);
        return hours * 60 * 60 * 1000;
    }

    const stopChanged = () => {
        // Recalculate duration
        const start = localTimeValue(document.querySelector('#start').value);
        const stop = localTimeValue(document.querySelector('#stop').value);
        if (stop === null || start === null) {
            document.querySelector('#duration').value = '';
            return;
        }
        const duration = stop.getTime() - start.getTime();
        const hours = duration / 1000 / 60 / 60;
        document.querySelector('#duration').value = hours;
    }

    const durationChanged = (duration) => {
        if (Number(duration) === duration) {
            const hours = duration / 1000 / 60 / 60;
            document.querySelector('#duration').value = hours;
        }
        // Recalculate stop
        const start = localTimeValue(document.querySelector('#start').value);
        if (start) {
            const durationValue = getDuration();
            const stop = new Date(start.getTime() + durationValue);
            document.querySelector('#stop').value = localTimeString(stop, true);
        } else {
            document.querySelector('#stop').value = document.querySelector('#start').value;
        }
    }

    const configFromForm = () => {
        const config = {
            session: document.querySelector('#session').value == '' ? null : parseInt(document.querySelector('#session').value),
            rate: parseFloat(document.querySelector('#rate').value),
            range: parseInt(document.querySelector('#range').value),
            start: localTimeValue(document.querySelector('#start').value),
            stop: localTimeValue(document.querySelector('#stop').value),
            metadata: document.querySelector('#metadata').value,
        };
        const notSpecified = [];
        if (typeof config.session !== 'number' || isNaN(config.session)) notSpecified.push('no session ID');
        if (typeof config.start !== 'object' || !config.start) notSpecified.push('no start time');
        if (typeof config.stop !== 'object' || !config.stop) notSpecified.push('no stop time');
        if (getDuration() <= 0) { notSpecified.push('no valid interval'); }
        if (notSpecified.length > 0) {
            throw "Error: " + notSpecified.join(', ') + '.';
        }
        return config;
    }

    const upsertMetadata = (metadata, id, newValue) => {
        if (metadata.length > 0 && metadata[0] == '?') { metadata = metadata.slice(1); }
        const parts = metadata.split('&');
        const components = [];
        let updated = false;
        for (let part of parts) {
            const equals = part.indexOf('=');
            const key = decodeURIComponent((equals >= 0) ? part.slice(0, equals) : part).replace(/\+/g, ' ');
            if (key.length <= 0) continue;
            //const value = decodeURIComponent((equals >= 0) ? part.slice(equals + 1) : '').replace(/\+/g, ' ');
            if (key == id) {
                if (!updated) {
                    updated = true;
                    if (newValue !== null) {
                        components.push(encodeURIComponent(key) + '=' + encodeURIComponent(newValue));
                    }
                }
                // else ignore repeated value
            } else {
                components.push(part);
            }
        }
        if (!updated) {
            components.push(encodeURIComponent(id) + '=' + encodeURIComponent(newValue));
        }
        return components.join('&');
    }

    const clearConfig = () => {
        //console.log('Clearing config...');
        const config = {
            session: null,
            rate: 100,
            range: 8,
            start: null,
            stop: null,
            metadata: '',
        }
        updateForm(config);
    }

    const setResult = (value, error = false) => {
        const elem = document.querySelector('#result');
        if (error) {
            elem.value = '⚠️ ' + value;
        } else {
            elem.value = value;
        }
    }

    let keyInput = new KeyInput(codeInput);
    const codeChanged = (code) => {
        console.log('CODE: ' + code);

        // Extract last 9 digits:
        const sessionId = code.trim().length > 0 ? parseInt('0' + code.replace(/[^0-9]/g, '').slice(-9)) : '';
        //
        // Extract last 9 alphanumeric characters convert non-numeric to '0':
        //const sessionId = parseInt('0' + code.replace(/[^A-Za-z0-9]/g, '').replace(/[^0-9]/g, '0').slice(-9))
        document.querySelector('#session').value = sessionId;

        document.querySelector('#metadata').value = upsertMetadata(document.querySelector('#metadata').value, '_sc', code);
        
        updateEnabled();
    };
    const submit = async () => {
        const code = document.querySelector(codeInput).value;

        // TODO: Turn code into config

        try {
            setResult('Configuring...', false);
            const config = configFromForm();
            console.log(JSON.stringify(config, null, 4));
            try {
                const status = await currentDevice.configure(config);
                console.log('CONFIG-STATUS: ' + JSON.stringify(status));
                setResult('ℹ️ Configured', false);
            } catch (e) {
                console.log('CONFIG-ERROR: ' + JSON.stringify(e));
                setResult(e, true);
            }
        } catch (e) {
            console.log('CONFIGURATION: ' + e);
            setResult(e, true);
        }

    };

    keyInput.start(codeChanged, submit);

    deviceManager.startup(deviceChanged);

    document.querySelector('#add_device').addEventListener('click', async () => {
        await deviceManager.userAddDevice();
    });

    for (let input of ['#session', '#rate', '#range', '#start', '#duration', '#stop', '#metadata']) {
        const elem = document.querySelector(input);
        elem.addEventListener('change', updateEnabled);
        elem.addEventListener('input', updateEnabled);
        elem.addEventListener('propertychange', updateEnabled);
    }

    for (let input of ['#duration']) {
        const elem = document.querySelector(input);
        elem.addEventListener('change', durationChanged);
        elem.addEventListener('input', durationChanged);
        //elem.addEventListener('propertychange', durationChanged);
    }

    for (let input of ['#stop']) {
        const elem = document.querySelector(input);
        elem.addEventListener('change', stopChanged);
        elem.addEventListener('input', stopChanged);
        //elem.addEventListener('propertychange', stopChanged);
    }

    clearConfig();

    watchParameters((params) => {
        console.log('PARAMS: ' + JSON.stringify(params));

        let showDebug = false; // default
        if (typeof params.nodebug !== 'undefined') showDebug = false;
        if (typeof params.debug !== 'undefined') showDebug = true;
        document.querySelector('body').classList.toggle('console', showDebug);

        let readonly = false; // default
        if (typeof params.editable !== 'undefined') readonly = false;
        if (typeof params.readonly !== 'undefined') readonly = true;
        for (let input of ['#session', '#rate', '#range', '#start', '#duration', '#stop', '#metadata']) {
            const elem = document.querySelector(input);
            if (readonly) {
                elem.setAttribute('disabled', 'true');
            } else {
                elem.removeAttribute('disabled');
            }
        }

        let details = false; // default
        if (typeof params.details !== 'undefined') details = true;
        if (typeof params.nodetails !== 'undefined') details = false;
        if (details) {
            document.querySelector('#details').setAttribute('open', 'true');
        } else {
            document.querySelector('#details').removeAttribute('open');
        }
    
        const newConfig = {
            session: null,
            rate: 100,
            range: 8,
            start: null,
            stop: 168,
            metadata: '',
        };
        let changedConfig = false;
        for (let part of ['session', 'rate', 'range', 'start', 'stop', 'metadata']) {
            if (typeof params[part] !== 'undefined') { newConfig[part] = params[part]; }
            changedConfig |= (typeof newConfig[part] !== typeof lastConfig[part] || newConfig[part] == lastConfig[part]);
        }

        if (changedConfig) {
            lastConfig = newConfig;
            console.log('PARAMS: Config changed: ' + JSON.stringify(newConfig));
            updateForm(newConfig);
        } else {
            console.log('PARAMS: Config not changed: ' + JSON.stringify(newConfig));
        }

        if (params.config) {
            keyInput.setValue(params.config);
        }
    });

});
