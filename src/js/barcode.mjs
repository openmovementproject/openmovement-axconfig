// Uses Quagga2 from: https://github.com/ericblade/quagga2
// Current version: 1.3.1
// ...from: https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.3.1/dist/quagga.js
// ...and:  https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.3.1/dist/quagga.min.js

import Quagga from './quagga.min.js';

export default class Barcode {

    constructor() {
        this.lastResult = null;
    }
   
    async init(initOptions) {
        await this.stop();
        this.target = initOptions.inputStream.target;
        await new Promise((resolve, reject) => {
            Quagga.init(initOptions, (err) => {
                if (err) {
                    console.log("BARCODE: Init error: " + err);
                    reject(err);
                    return;
                } else {
                    console.log("BARCODE: Init finished");
                    resolve();
                }
            });
        });
    }

    async start() {
        await this.stop();

        Quagga.start();

        this.callbackDetected = this.detected.bind(this);
        Quagga.onDetected(this.callbackDetected);

        this.callbackProcessed = null;
        //this.callbackProcessed = this.processed.bind(this);
        if (this.callbackProcessed) {
            Quagga.onProcessed(this.callbackProcessed);
        }

        this.started = true;
    }

    detected(data) {
        if (data.codeResult && data.codeResult.code) {
            this.lastResult = data.codeResult.code;
            console.log('BARCODE: Detected: ' + this.lastResult + ' -- ' + JSON.stringify(data.codeResult))
            if (this.promiseScanCancelResolve) {
                this.promiseScanCancelResolve(this.lastResult);
            }
            this.promiseScanCancelResolve = null;
            this.promiseScanCancelReject = null;
        }
    }

    processed(data) {
        //console.log('(BARCODE: Processed)')
        // const canvas = this.target.querySelector('canvas');
        // if (canvas) {
        //     const ctx = canvas.getContext('2d');
        //     ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        // }
    }

    async stop() {
        if (this.started) {
            await Quagga.stop();
            this.started = false;
        }

        if (this.callbackDetected) {
            Quagga.offDetected(this.callbackDetected);
            this.callbackDetected = null;
        }

        if (this.callbackProcessed) {
            Quagga.offProcessed(this.callbackProcessed);
            this.callbackProcessed = null;
        }
    
        this.lastResult = null;
        if (this.promiseScanCancelResolve) {
            this.promiseScanCancelResolve(this.lastResult);
        }
        this.promiseScanCancelResolve = null;
        this.promiseScanCancelReject = null;
    }

    async waitForScanOrCancel() {
        const promiseScanCancel = new Promise((resolve, reject) => {
            this.promiseScanCancelResolve = resolve;
            this.promiseScanCancelReject = reject;
        });
        return promiseScanCancel;
    }
}

Barcode.instance = null;

Barcode.cancel = async () => {
    if (Barcode.instance) {
        await Barcode.instance.stop();
    }
}

Barcode.scan = async (options) => {
    const elementSelector = (options && options.elementSelector) ? options.elementSelector : '#interactive.viewport';

    if (!Barcode.instance) {
        Barcode.instance = new Barcode();
    }
    
    const initOptions = {
        inputStream : {
            name : 'Live',
            type : 'LiveStream',
            constraints: {
                //width: 640,
                //height: 480,
                facingMode: 'environment',
            },
            /*area: {
                top:    '20%',
                right:  '20%',
                left:   '20%',
                bottom: '20%',
            },*/
            target: document.querySelector(elementSelector),
        },
        decoder : {
            readers : ['code_128_reader'], // (Overridden below) 'code_128_reader', 'ean_reader', 'ean_8_reader', 'code_39_reader', 'code_39_vin_reader', 'codabar_reader', 'upc_reader', 'upc_e_reader', 'i2of5_reader', '2of5_reader', 'code_93_reader',
            debug: false, /*{
                drawBoundingBox: false,
                showFrequency: false,
                drawScanline: false,
                showPattern: false,
            },*/
            //multiple: false,
        }
    };
    
    const availableReaders = {
        'code_128':    'code_128_reader',
        'ean':         'ean_reader', 
        'ean_8':       'ean_8_reader', 
        'code_39':     'code_39_reader', 
        'code_39_vin': 'code_39_vin_reader', 
        'codabar':     'codabar_reader', 
        'upc':         'upc_reader', 
        'upc_e':       'upc_e_reader', 
        'i2of5':       'i2of5_reader', 
        '2of5':        '2of5_reader', 
        'code_93':     'code_93_reader',
    };

    // Set readers 
    const readers = (options && options.readers) ? options.readers : 'code_128';
    const readerList = readers.split(',');
    if (readerList.length > 0) {
        initOptions.decoder.readers = [];
        for (const id of readerList) {
            const reader = availableReaders[id];
            if (!reader) {
                throw new Exception('Unknown barcode type: ' + id);
            }
            initOptions.decoder.readers.push(reader);
        }
    }

    let result = null;
    try {
        await Barcode.instance.init(initOptions);
        await Barcode.instance.start();
        result = await Barcode.instance.waitForScanOrCancel();
    } finally {
        await Barcode.instance.stop();
        document.querySelector(elementSelector).innerHTML = '';
    }

    return result;
}
