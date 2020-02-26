// Handle input from an external keyboard-emulated reader (e.g. USB barcode or RFID reader)
// Writes code in an input element, supports manual entry, submits the form when entered.
export default class KeyInput {

    constructor(inputSelector) {
        this.inputSelector = inputSelector;
        this.inputBuffer = '';
        this.timeoutId = null;
    }

    start(changeCallback = null, submitCallback = null) {
        this.changeCallback = changeCallback;

        document.onkeydown = this.keydown.bind(this);

        const codeChanged = () => {
            const elem = document.querySelector(this.inputSelector);
            if (changeCallback) {
                const code = elem.value;
                //console.log('KEYINPUT: > ' + code);
                changeCallback(code);
            }
        }

        const elem = document.querySelector(this.inputSelector);
        elem.addEventListener('input', codeChanged);
        elem.addEventListener('change', codeChanged);
        elem.addEventListener('focus', function() {
            this.select();
        });

        elem.form.onsubmit = (event) => {
            const elem = document.querySelector(this.inputSelector);
            event.preventDefault();
            elem.blur();
            if (!elem.form.querySelector('input[type=submit]').disabled) {
                if (submitCallback) {
                    const code = elem.value;
                    //console.log('KEYINPUT: = ' + code);
                    submitCallback(code);
                }
            }
            return false;
        };

        // Set with current value
        codeChanged();
    }

    setValue(value, submit = false) {
        this.inputBuffer = '';
        const elem = document.querySelector(this.inputSelector);
        if (!elem) {
            console.log('KEYINPUT: Error: element not found: ' + this.inputSelector);
            return;
        }
        if (arguments.length > 0) {
            console.log('KEYINPUT: ' + value);
            elem.value = value;
        }
        elem.dispatchEvent(new Event('change', { 'bubbles': true }));
        if (submit) {
            const submitElem = elem.form.querySelector('input[type="submit"]');
            if (submitElem) {
                submitElem.click();
            }
        }
    }

    submitEnabled(enabled) {
        const elem = document.querySelector(this.inputSelector);
        const submitElem = elem.form.querySelector('input[type=submit]');
        submitElem.disabled = !enabled;
    }

    keydown(evt) {
        let allowInput = true;
        evt = evt || window.event;

        // Ignore input if not configured
        if (!this.inputSelector) {
            allowInput = false;
        }

        // Do not interfere with direct text input
        if (document.activeElement) {
            if (document.activeElement.tagName == 'INPUT' && ['text', 'password', 'date', 'email', 'number', 'search'].indexOf(document.activeElement.type) >= 0) {
                allowInput = false;
            }
            if (document.activeElement.tagName == 'TEXTAREA') {
                allowInput = false;
            }
        }
        
        // Do not touch keys with control/alt modifiers
        if (evt.altKey || evt.ctrlKey) {
            allowInput = false;
        }
        
        // Control characters
        if (evt.which < 32) {	// === 13
            if (this.inputBuffer.length > 0 && evt.which == 13) {
                evt.preventDefault();
                this.setValue(this.inputBuffer, true);
            }
            allowInput = false;
        }

        // Only accept where the .key is one character
        if (!evt.key || evt.key.length != 1) {
            allowInput = false;
        }

        // Prevent the current input from timeout
        if (this.timeoutId !== null) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }

        // If ignoring press, remove input buffer
        if (!allowInput) {
            this.inputBuffer = '';
            return;
        }

        // Add key press to buffer
        evt.preventDefault();
        this.inputBuffer += evt.key; // String.fromCharCode(evt.which);
        //console.log('> ' + this.inputBuffer);
        this.timeoutId = setTimeout((function() {
            //this.setValue(this.inputBuffer, false);
            this.inputBuffer = '';
            //console.log('KEYINPUT: > (timeout)');
        }).bind(this), 2000);
    };

}
