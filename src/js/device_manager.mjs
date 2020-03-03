import UsbDevice from './usb_device.mjs';
import SerialDevice from './serial_device.mjs';

import Ax3Device from './ax3device.mjs';


export default class DeviceManager {

    constructor(enableSerial) {
        this.enableSerial = enableSerial;
        this.usbDevices = {};
        this.serialDevices = {};
        this.warnings = [];
        if (location.protocol === 'file:') {
            this.warnings.push('WARNING: Features may not work over the file: protocol (try via a web server).');
        }
        if (location.protocol !== 'https:') {
            this.warnings.push('WARNING: Features require secure HTTPS.');
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
        if (navigator.usb && navigator.appVersion.indexOf('(Windows') >= 0 && (!enableSerial || !navigator.serial)) {
            this.warnings.push('WARNING: WebUSB will not work on Windows as standard (CDC devices claimed by the driver).');
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
        const usbSeen = {};
        if (navigator.usb) {
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
        }
        for (let device of Object.keys(this.usbDevices)) {
            if (!(device in usbSeen)) {
                console.log('DEVICEMANAGER: USB Enumerate device lost ' + device);
                const axDevice = this.usbDevices[device];
                if (this.changedHandler) this.changedHandler(axDevice, device, 'disconnect')
                delete this.usbDevices[device];
            }
        }
        */

        // Poll serial devices to determine what's still connected (TODO: better detection of disconnect?)
        const serialSeen = {};
        if (navigator.serial) {
            if (!navigator.serial.getPorts) {
                //console.log('DEVICEMANAGER: Serial enumerate not available.');
            } else {
                const currentPorts = await navigator.serial.getPorts();
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

    async userAddUsbDevice() {
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
        if (!('serial' in navigator)) {
            throw 'ERROR: Web Serial API is not supported in this browser configuration.';
        }
        try {
            const port = await navigator.serial.requestPort({
                filters: [
                    { vendorId: Ax3Device.USB_DEVICE_VID, productId: Ax3Device.USB_DEVICE_PID },
                ]
            });
            console.log('DEVICEMANAGER: Request serial ' + port);
            if (!(port in this.serialDevices)) {
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
        const numDevices = Object.keys(this.usbDevices).length + Object.keys(this.serialDevices).length;
        console.log('DEVICEMANAGER: Has ' + numDevices + ' device(s).')
        if (numDevices !== 1) return null;   // Do not choose any device if it is ambiguous
        if (Object.keys(this.usbDevices).length > 0) return Object.values(this.usbDevices)[0];
        if (Object.keys(this.serialDevices).length > 0) return Object.values(this.serialDevices)[0];
        return null;
    }

}

