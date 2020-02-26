import Ax3Device from './ax3device.mjs';

export default class DeviceManager {

    constructor() {
        this.devices = {};
        if (navigator.appVersion.indexOf('(Windows') >= 0) {
            console.log('WARNING: On Windows, CDC devices are likely to be claimed by the driver.');
        }
        if (location.protocol === 'file:') {
            console.log('WARNING: WebUSB may not work over the file: protocol -- try via a web server.');
        }
        if (location.protocol !== 'https:') {
            console.log('WARNING: WebUSB may require secure HTTPS.');
        }
        if (!navigator.usb) {
            console.log('ERROR: WebUSB not supported in this browser.');
        }
    }

    async startup(changedHandler) {
        this.changedHandler = changedHandler;

        if (!navigator.usb) {
            return false;
        }

        navigator.usb.addEventListener('disconnect', (event) => {
            const device = event.device;
            console.log('DEVICEMANAGER: Disconnect ' + device);
            const axDevice = this.devices[device];
            delete this.devices[device];
            if (this.changedHandler) this.changedHandler(axDevice, device, 'disconnect')
        });
    
        navigator.usb.addEventListener('connect', (event) => {
            const device = event.device;
            console.log('DEVICEMANAGER: Connect ' + device);
            const axDevice = new Ax3Device(device);
            this.devices[device] = axDevice;
            if (this.changedHandler) this.changedHandler(axDevice, device, 'connect')
        });
    
        const currentDevices = await navigator.usb.getDevices();
        for (let device of currentDevices) {
            console.log('DEVICEMANAGER: Enumerate ' + device);
            const axDevice = new Ax3Device(device);
            this.devices[device] = axDevice;
            if (this.changedHandler) this.changedHandler(axDevice, device, 'get')
        }

        return true;
    }

    async userAddDevice() {
        if (!navigator.usb) {
            return false;
        }
        try {
            const device = await navigator.usb.requestDevice({
                filters: [
                    { vendorId: Ax3Device.USB_DEVICE_VID, productId: Ax3Device.USB_DEVICE_PID },
                    //{ vendorId: 0x1234, productId: 0x5678 },        // test device
                    //{ vendorId: 0x2345, productId: 0x6789 },        // test device
                    //{ vendorId: 0x3456, productId: 0x789A },        // test device
                    //{ vendorId: 0x4567, productId: 0x89AB },        // test device
                ]
            });
            console.log('DEVICEMANAGER: Request ' + device);
            const axDevice = new Ax3Device(device);
            this.devices[device] = axDevice;
            if (this.changedHandler) this.changedHandler(axDevice, device, 'request');
            return true;
        } catch (e) {
            if (e.name == 'NotFoundError') {
                console.log('NOTE: User did not select a device: ' + e.name + ' -- ' + e.message);
            } else {
                console.log('ERROR: ' +  e + ' -- ' + e.name + ' -- ' + e.message);
            }
            return false
        }
    }

    getSingleDevice() {
        const numDevices = Object.keys(this.devices).length;
        console.log('DEVICEMANAGER: Has ' + numDevices + ' device(s).')
        if (numDevices != 1) {
            return null;
        }
        return Object.values(this.devices)[0];
    }

}

