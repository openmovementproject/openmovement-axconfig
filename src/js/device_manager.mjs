import UsbDevice from './usb_device.mjs';
import SerialDevice from './serial_device.mjs';

import Ax3Device from './ax3device.mjs';


export default class DeviceManager {

    constructor(enableUsb, enableSerial) {
        this.enableSerial = enableSerial;
        this.lastAdd = null;
        this.usbDevices = {};
        this.serialDevices = {};
        this.warnings = [];
        if (location.protocol === 'file:') {
            this.warnings.push('WARNING: Features may not work over the file: protocol (try via an HTTP web server).');
        }
        if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1' && location.hostname !== '::1') {
            this.warnings.push('WARNING: Features may require secure HTTPS on non-loopback connections.');
        }
        if (!navigator.usb && !navigator.serial) {
            this.warnings.push('WARNING: This browser configuration does not support device connection (WebUSB or Web Serial API).');
        }
        /*
        if (!navigator.usb) {
            this.warnings.push('WARNING: WebUSB is not supported in this browser configuration.');
        }
        */
        /*
        if (!navigator.serial && enableSerial) {
            this.warnings.push('WARNING: Web Serial API is not supported in this browser configuration.');
        }
        */
        /*
        if (!navigator.serial && enableSerial) {
            const ua = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);
            const chromeVersion = ua ? parseInt(ua[2], 10) : null;
            if (chromeVersion >= 77) {
                this.warnings.push('NOTE: Web Serial API may be enabled at: chrome://flags#enable-experimental-web-platform-features');
            }
        }
        */
        if (enableUsb && navigator.usb && navigator.appVersion.indexOf('(Windows') >= 0 && (!enableSerial || !navigator.serial)) {
            this.warnings.push('WARNING: WebUSB will not work on Windows as standard (CDC devices claimed by the driver). ' + (enableSerial ? ' You can try enabling the experimental Web Serial API at: chrome://flags#enable-experimental-web-platform-features and/or see Help for experimental firmware with WinUSB and Generic interface support.' : ''));
        }
        for (let warning of this.warnings) {
            console.log(warning);
        }
    }

    async startup(changedHandler) {
        this.changedHandler = changedHandler;

        if (navigator.usb) {
            navigator.usb.addEventListener('disconnect', (event) => {
                const device = event.device;
                console.log('DEVICEMANAGER: USB Disconnect ' + device);
                const axDevice = this.usbDevices[device];
                delete this.usbDevices[device];
                if (this.changedHandler) this.changedHandler(axDevice, device, 'disconnect')
            });
        
            navigator.usb.addEventListener('connect', (event) => {
                const device = event.device;
                console.log('DEVICEMANAGER: USB Connect ' + device);
                const axDevice = new Ax3Device(new UsbDevice(device));
                this.usbDevices[device] = axDevice;
                if (this.changedHandler) this.changedHandler(axDevice, device, 'connect')
            });
        }

        await this.refreshDevices();

        return true;
    }


    async refreshDevices() {
        /*
        if (navigator.usb) {
            const usbSeen = {};
            const currentDevices = await navigator.usb.getDevices();
            for (let device of currentDevices) {
                usbSeen[device] = device;
                if (!(device in this.usbDevices)) {
                    console.log('DEVICEMANAGER: USB Enumerate ' + device);
                    const axDevice = new Ax3Device(new UsbDevice(device));
                    this.usbDevices[device] = axDevice;
                    if (this.changedHandler) this.changedHandler(axDevice, device, 'get')
                }
            }
            for (let device of Object.keys(this.usbDevices)) {
                if (!(device in usbSeen)) {
                    console.log('DEVICEMANAGER: USB Enumerate device lost ' + device);
                    const axDevice = this.usbDevices[device];
                    if (this.changedHandler) this.changedHandler(axDevice, device, 'disconnect')
                    delete this.usbDevices[device];
                }
            }
        }
        */

        // Poll serial devices to determine what's still connected (TODO: better detection of disconnect?)
        if (navigator.serial) {
            const serialSeen = {};
            if (!navigator.serial.getPorts) {
                //console.log('DEVICEMANAGER: Serial enumerate not available.');
            } else {
                let currentPorts = [];
                try {
                    currentPorts = await navigator.serial.getPorts();
                } catch (e) {
                    if (!this.firstSerialEnumerateError) {
                        this.firstSerialEnumerateError = true;
                        console.log('ERROR: Problem enumerating serial devices: ' + e + ' -- ' + JSON.stringify(e));
                    }
                }
                for (let port of currentPorts) {
                    serialSeen[port] = port;
                    if (!(port in this.serialDevices)) {
                        console.log('DEVICEMANAGER: Serial Enumerate ' + port);
                        const axDevice = new Ax3Device(new SerialDevice(port));
                        this.serialDevices[port] = axDevice;
                        if (this.changedHandler) this.changedHandler(axDevice, port, 'get')
                    }
                }
            }
            for (let port of Object.keys(this.serialDevices)) {
                if (!(port in serialSeen)) {
                    console.log('DEVICEMANAGER: Serial Enumerate device lost ' + port);
                    const axDevice = this.serialDevices[port];
                    if (this.changedHandler) this.changedHandler(axDevice, port, 'disconnect')
                    delete this.serialDevices[port];
                }
            }
        }
    }

    async userAddUsbDevice() {
        this.lastAdd = 'usb';
        if (!navigator.usb) {
            throw 'ERROR: WebUSB is not supported in this browser configuration.';
        }
        try {
            const device = await navigator.usb.requestDevice({
                filters: [
                    { vendorId: Ax3Device.USB_DEVICE_VID, productId: Ax3Device.USB_DEVICE_PID },
                    //{ vendorId: 0x1234, productId: 0x5678 },        // test device    // (see http://pid.codes/howto/ 0x1209)
                    //{ vendorId: 0x2345, productId: 0x6789 },        // test device
                    //{ vendorId: 0x3456, productId: 0x789A },        // test device
                    //{ vendorId: 0x4567, productId: 0x89AB },        // test device
                ]
            });
            console.log('DEVICEMANAGER: Request USB ' + device);
            if (!(device in this.usbDevices)) {
                const axDevice = new Ax3Device(new UsbDevice(device));
                this.usbDevices[device] = axDevice;
            }
            if (this.changedHandler) this.changedHandler(this.usbDevices[device], device, 'request');
            return true;
        } catch (e) {
            if (e.name == 'NotFoundError') {
                console.log('NOTE: User did not select a device: ' + e.name + ' -- ' + e.message);
                throw 'No device chosen.';
            } else {
                console.log('ERROR: ' +  e + ' -- ' + e.name + ' -- ' + e.message);
                throw 'ERROR: ' +  e + ' -- ' + e.name + ' -- ' + e.message;
            }
        }
    }

    async userAddSerialDevice() {
        this.lastAdd = 'serial';
        if (!('serial' in navigator)) {
            throw 'ERROR: Web Serial API is not supported in this browser configuration.';
        }
        try {
            const requestOptions = {
                filters: [{ 
                    usbVendorId: Ax3Device.USB_DEVICE_VID, usbProductId: Ax3Device.USB_DEVICE_PID,  // newer syntax, see: https://github.com/WICG/serial/blob/gh-pages/EXPLAINER.md#potential-api
                       vendorId: Ax3Device.USB_DEVICE_VID,    productId: Ax3Device.USB_DEVICE_PID,  // older syntax (TODO: Delete)
                }]
            };
            const port = await navigator.serial.requestPort(requestOptions);
            console.log('DEVICEMANAGER: Request serial ' + port);
            if (!(port in this.serialDevices)) {
                if (this.serialDevices.length > 0) {
                    console.log('WARNING: Only one serial device is supported at a time, but about to add another -- removing old.');
debugger;
                    const oldPort = Object.keys(this.serialDevices)[0];
                    const oldAxDevice = this.serialDevices[oldPort];
                    if (this.changedHandler) this.changedHandler(oldAxDevice, oldPort, 'disconnect')
                    delete this.serialDevices[oldPort];
                }
                const axDevice = new Ax3Device(new SerialDevice(port));
                this.serialDevices[port] = axDevice;
            }
            if (this.changedHandler) this.changedHandler(this.serialDevices[port], port, 'request');
            return true;
        } catch (e) {
            if (e.name == 'NotFoundError') {
                console.log('NOTE: User did not select a device: ' + e.name + ' -- ' + e.message);
                throw 'No device chosen.';
            } else {
                console.log('ERROR: ' +  e + ' -- ' + e.name + ' -- ' + e.message);
                throw 'ERROR: ' +  e + ' -- ' + e.name + ' -- ' + e.message;
            }
        }
    }

    getSingleDevice() {
        const numUsbDevices = Object.keys(this.usbDevices).length;
        const numSerialDevices = Object.keys(this.serialDevices).length;
        if (numUsbDevices == 0 && numSerialDevices == 0) {
            console.log('ERROR: DeviceManager has no devices -- this will only work for a single device.');
            return null;   // Do not choose a device if none are available
        }

        if (numUsbDevices + numSerialDevices !== 1) {
            console.log('WARNING: DeviceManager has ' + numUsbDevices + ' USB device(s) and ' + numSerialDevices + ' serial device(s).');
            console.log('USB: ' + JSON.stringify(this.usbDevices));
            console.log('SERIAL: ' + JSON.stringify(this.serialDevices));

            if (this.lastAdd == 'usb' && numUsbDevices > 0) {
                console.log('NOTE: Choosing USB...');
                if (numUsbDevices > 1) {
                    console.log('ERROR: Multiple USB, but this will only work with a single device.');
                    return null; // Ambiguous
                }
                // Single USB device
                return Object.values(this.usbDevices)[0];
            }

            if (numSerialDevices > 1) {
                console.log('ERROR: Multiple Serial, but this will only work with a single device.');
                return null; // Ambiguous
            } else if (numSerialDevices == 1) {
                // Single USB device
                return Object.values(this.serialDevices)[0];
            }

            console.log('ERROR: DeviceManager had an unexpected issue trying to resolve a single device.')
            return null;
        }

        // A single device
        if (numSerialDevices > 0) return Object.values(this.serialDevices)[0];
        if (numUsbDevices > 0) return Object.values(this.usbDevices)[0];
        console.log('ERROR: DeviceManager had an unexpected issue trying to resolve a single device.')
        return null;
    }

}

