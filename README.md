# AX Device Web Configuration Tool

This is a web-based configuration tool for [AX Devices](https://github.com/digitalinteraction/openmovement/wiki/AX3), and is part of the [Open Movement](https://openmovement.dev/) project.

To configure a device:

1. Visit the address: [`config.openmovement.dev`](https://config.openmovement.dev/)

2. Connect the device.  You may only configure one device at a time.  If on a mobile phone or tablet, you may need a special adapter or cable from your mobile device's connector (USB Micro-B female, or USB C female port), to the AX device's USB Micro-B female port. 

3. Choose *Connect USB device...* on Android/Mac, or *Connect Serial device...* on Windows (if this option does not appear, see below for how to enable it).

4. Select your device and click *Connect*.

5. Enter your configuration *Code* (which will be used to identify the recording).

6. Check that the details of the recording configuration are correct.  If you use the same details for multiple devices, consider altering the URL as described below and bookmarking the page to fix these values.

7. Verify that the device's current state and battery level is suitable, then select *Configure* to program the device.



## How it communicates

The AX devices are a *Composite USB Device* made up of a *USB Mass Storage Device Class* (to serve the data file, like a standard USB drive), and a *USB Communications Device Class (CDC)* (a serial device).  See [AX Device - Technical Documentation](https://github.com/digitalinteraction/openmovement/blob/master/Docs/ax3/ax3-technical.md) for more information.  To configure the devices the tool must communicate with the CDC device from the web page. 

On some platforms (e.g. Mac and on some Android devices), the CDC connection is available as a standard USB interface and communication is possible on supported browsers via *WebUSB*.  (Additional debugging for this may be available in your browser at: `chrome://device-log` and `chrome://usb-internals`.)

However, on other platforms, the CDC device is taken by a standard serial driver (e.g. some Android devices as `/dev/ttyACM*`, or Windows as `\\.\COM*`).  There is a second communication approach that supports serial connections, the *Web Serial API*, and this should work on supported browsers (e.g. Chrome on Windows, but may require enabling at `chrome://flags#enable-experimental-web-platform-features`).

Android is not a supported platform for the *Web Serial API* (as there is not a serial driver on all devices) and, on some platforms, access to serial devices (`/dev/ttyACM*`) appears to be completely forbidden to all applications (via a Security-Enhanced Linux configuration).  If your particular device is affected, you may be able to get around this limitation with an [experimental AX3 device firmware V50 with WinUSB and Generic interface support](https://raw.githubusercontent.com/digitalinteraction/openmovement/master/Downloads/AX3/AX3-Firmware-50-winusb-generic.zip) -- this firmware supports an additional "generic" interface for device communication (which does not appear to be a serial CDC device) and, in addition, supports the WinUSB descriptors which allows the interface to be visible to user applications on Windows (please note that this firmware is experimental and not yet thoroughly tested).

Although not currently used by the configuration tool, an additional approach would be to use a local native binary for device communication and for the web page to talk to this service either through a WebExtension using Native Messaging, and/or by running a local server over HTTP(S)/WebSocket (although this approach has difficulties with some APIs needing to be run over HTTPS, while `localhost` is not considered secure by all browsers without trusting a generated, self-signed certificate).


## Connection troubleshooting

If you have difficulties connecting a device (such as a `Could not claim interface` error) you should:

1. Ensure you are using a web browser that supports *WebSerial*/*WebUSB*, such as *Chrome* or *Edge*.
2. Be sure to close any other programs that will try to communicate with the devices (such as *Om GUI*)
3. Reset device access methods -- **revoke existing device access:**
    1. Visit the configuration page
    2. On the page, press the *View site information* icon to the left of the website address, marked `ⓘ`.
    3. For all permissions labelled *AX3 Composite Device* or *AX6 Composite Device*: 
       * Press the *Revoke Access* button to the right, marked `✖` or `⏏`.  
    4. Press the `↺` *Refresh* link at the very bottom of the page.
4. Be sure to use the *Connect serial device...* button to communicate with the device.  Only try the *Alternative connect device...* if the serial method does not work, e.g. on some *Android* devices (and you may need to check the instructions above under *How it communicates* and try the alternative firmware for the AX3).
5. Once connected, you should be able to complete any configuration/diagnostics as required.

If there are connection issues that prevent you from completing the above steps, please see the [AX Troubleshooting](https://github.com/digitalinteraction/openmovement/blob/master/Docs/ax3/ax3-troubleshooting.md) guide.

**Configuration on Linux:** (including Debian and Ubuntu)
1. Using the *Chromium* browser, change the flags using the URL: `about:flags`, enabling:
  * `Automatic detection of WebUSB-compatible devices`
  * `Enable Isolated Web Apps to bypass USB restrictions`
2. Make the user member of group `dialout`: `sudo usermod -a -G dialout $USER`
3. Restart *X*, e.g. `sudo service lightdm restart`
4. Configure the AX device via the serial port (`/dev/ttyACM*`).


## URL-based options

Options can be added to the address by appending a hash (`#`) then `key=value` pairs separated with an ampersand (`&`).  In special circumstances, you can place options after a question mark (`?`), but changing these must be done online as this will cause the page to be reloaded -- an advantage of this is that this URL can be stored to a home screen shortcut while keeping the custom options.  The options are:

* `title=AX+Configure` - set the page and tab title (e.g. to make the configuration/protocol clear; use "form URL-encoded" to escape special characters).
* `focus` - immediately focus the *Code* input box for entry.
* `nodetails` - hide detailed settings by default.
* `readonly` - do not allow editing of the detailed settings.
<!-- * `session=123456789` - session ID (9 digit numeric; use `config` instead which allows longer alphanumeric IDs stored in the *subject code*) -->
* `config=123456789` - recording identifier (set as the *subject code* in the metadata; the last 9 digits will also be used as the device's numeric session ID)
* `rate=100` - sensor rate (Hz, default `100`, allowed `12.5|25|50|100|200|400|800|1600|3200`)
* `range=8` - sensor range (*g*, default `8`, allowed `2|4|8|16`)
* `gyro=0` - gyro sensitivity (*dps*, default `0`=none, allowed `250|500|1000|2000`)
* `start=0` - delay until start from current time (hours, default `0`); or an exact start time (`YYYY-MM-DDThh:mm:ss`; add a `Z` suffix to use UTC, otherwise in local time). Negative values are treated as (positive) hours after the previous midnight in local time.  For example, `-20`=8pm today's evening; `-24`=midnight tonight; `-32`=8am tomorrow morning.
* `stop=168` - duration of recording (hours, default 168); or an exact stop time (`YYYY-MM-DDThh:mm:ss`; add a `Z` suffix to use UTC, otherwise in local time).
* `metadata=` - metadata to add to the recording (use URL-encoded format which will need double-escaping in a URL; a subject code `_sc` will also be added from the `config` value)
* `minbattery=80` - minimum battery percentage at configuration time (configuration will fail unless the device is at this level, default none).
* `noscan` - Disable camera-based barcode scanning button.
* `readers=code_128` - Specify which camera-based barcode scanning decoders are enabled (default, `code_128`); a comma-separated list (only enable the specific ones you need to prevent problems with simpler codes), options: `code_128,ean,ean_8,code_39,code_39_vin,codabar,upc,upc_e,i2of5,2of5,code_93`
* `debug` - show debug console information.
* `noconfigure` - disable configuration controls (useful for a diagnostics-only mode)
* `diagnostics` - initially show diagnostics control

...an example URL with multiple options: `https://config.openmovement.dev/#readonly&nodetails&rate=100&range=8&start=0&stop=168`.  If you wanted to add a *Study Code*, something like this: `https://config.openmovement.dev/#readonly&nodetails&rate=100&range=8&start=0&stop=168&metadata=_s%3dMy_Study_Name`.  And if you also knew the recording identifier, it can be embedded into the link: `https://config.openmovement.dev/#readonly&nodetails&rate=100&range=8&start=0&stop=168&metadata=_s%3dMy_Study_Name&code=123abc456`.


## Offline

The web application is cached so that it works offline.  In Chrome-based browsers, see `chrome://serviceworker-internals` (or `chrome://appcache-internals/` for earlier versions of this application).  The application is also a *Progressive Web App* and can be installed to the user's desktop/home screen/launcher.


## Configuration logs

Logs are stored locally in the browser.  The following options affect the logs: `nolog`, remove log buttons; `nologclear`, remove *Clear Log* button.  When *Download Log* is clicked, the downloaded log file is in *.CSV* format. Times are local and in the format `YYYY-MM-DD hh:mm:ss`. The *type* reports success/failure and is `AX3-CONFIG-OK`/`AX3-CONFIG-FAILURE` (final configuration check did not match)/`AX3-CONFIG-ERROR` (or `AX6-` prefixed). The line format is:

```
time,type,deviceId,sessionId,start,stop,frequency,range,"metadata",gyroRange,"subjectCode"
```


## Manually downloading data

> [!NOTE]
> The configuration tool does not properly support downloading data as it is only connected via the configuration serial port, and not the mass storage device connection that the data is available through.  There is an experimental option to download the file using the device's raw sector reads over its communication channel, requiring the web page to parse the filesystem directly, but this is only really intended for checking the device configuration, and is far, far to slow for typical recordings.

When you connect a device to your computer, you should see it appear as an external drive (e.g. in Windows *Explorer* or macOS *Finder*).  If you open the drive, you should see the recorded data file `CWA-DATA.CWA`, which you may copy off to another location on your computer.  This transfer will typically take many minutes.  It would be a good idea to rename the file (keeping the `.cwa` file extension) to a unique filename (e.g. based on the session ID, device ID or date), to make sure the file can be identified later and that you do not overwrite a file with one of the same name.

Advanced users may run [cwa_metadata.py](https://raw.githubusercontent.com/digitalinteraction/openmovement/master/Software/AX3/cwa-convert/python/cwa_metadata.py) to examine the metadata from a `.cwa` file, such as the session ID.  

If you have any issues with the device data, please see: [AX Troubleshooting: Filesystem or data problems](https://github.com/openmovementproject/openmovement/blob/master/Docs/ax3/ax3-troubleshooting.md#filesystem-or-data-problems).


## Data analysis

Please see:

* [AX Devices for Physical Activity Research: Data Analysis](https://github.com/openmovementproject/openmovement/blob/master/Docs/ax3/ax3-research.md#data-analysis)


<!--

## Device Diagnostics

1. Open a browser that supports *Web Serial*, such as *Google Chrome* or *Edge*.
2. Visit the page: [AX Diagnostics](https://config.openmovement.dev/#diagnostics&nolog&noconfigure&title=AX+Diagnostics)
3. Ensure a single device is connected (wait around 10 seconds after connecting the device).
4. Click: *Connect serial device...* and choose the attached *AX* device.
5. Click: *Device Diagnostics* to generate the diagnostic report.
6. Click: *Download Report* to save a copy of the diagnostics report.

## File Diagnostics

1. In your browser, visit the page: [AX Diagnostics](https://config.openmovement.dev/#diagnostics&nolog&noconfigure&title=AX+Diagnostics)
2. Click: *File Diagnostics*.
3. Select your `.cwa` file and press *Open* to generate the diagnostic report.
4. Click: *Download Report* to save a copy of the diagnostics report.

## Device Wipe and Reset

1. Open a browser that supports *Web Serial*, such as *Google Chrome* or *Edge*.
2. Visit the page: [AX Diagnostics](https://config.openmovement.dev/#diagnostics&nolog&noconfigure&title=AX+Diagnostics)
3. Ensure a single device is connected (wait around 10 seconds after connecting the device).
4. Click: *Connect serial device...* and choose the attached *AX* device.
5. Click: *Reset* and *OK*.
6. Only if you are resetting the device ID: enter the device ID as displayed on the device case.
7. Click: *OK*.
8. The device will be wiped and reset.


---

If you are using Linux you may need to add a `udev` entry to prevent the device from being claimed by another driver.  
Debug using the commands `lsusb -v -d 04d8:0057` and `dmesg | tail -n 30` (also `udevadm info -a -p $(udevadm info -q path -n /dev/ttyACM0)` and, to temporarily remove the ACM module, `sudo rmmod cdc_acm`; or `echo "cdc_acm" | sudo tee -a /etc/modules`). For example, on Debian/Ubuntu/Raspbian, assume the user (e.g. `pi`) is in `plugdev` group, create `/etc/udev/rules.d/07-cwa.rules`:

```
SUBSYSTEM=="usb", ATTR{idVendor}=="04d8", ATTR{idProduct}=="0057", MODE="0664", GROUP="plugdev", ENV{ID_MM_DEVICE_IGNORE}="1", ENV{ID_MM_TTY_BLACKLIST}="1", ENV{MTP_NO_PROBE}="1", ENV{ID_MM_PORT_IGNORE}="1", ENV{ID_MM_TTY_MANUAL_SCAN_ONLY}="1", RUN="/bin/sh -c 'echo -n $kernel >/sys/bus/usb/drivers/usbhid/unbind'"
```

```
ATTRS{idVendor}=="04d8", ATTRS{idProduct}=="0057", ATTR{bInterfaceNumber}="01", MODE="0664", GROUP="plugdev", OPTIONS+="last_rule", OPTIONS+="ignore_device"
```

NOTE: 'ATTRS' matches on parent -- this is a composite device, interface 1.

```
DRIVERS=="cdc_acm", OPTIONS+="ignore_device", OPTIONS+="last_rule"
```

```
SUBSYSTEM=="usb", ATTRS{idVendor}=="04d8", ATTRS{idProduct}=="0057", MODE="0664", GROUP="plugdev", OPTIONS+="last_rule"
```

```
KERNEL=="ttyACM*", SUBSYSTEMS=="usb", ACTION=="add", ATTRS{idVendor}=="04d8", ATTRS{idProduct}=="0057", MODE="0666", PROGRAM="/bin/bash -c '/bin/echo %p | /bin/grep -c :1.1", RESULT=="1", OPTIONS+="ignore_device", GROUP="plugdev"
```

```
SUBSYSTEM=="usb", ATTR{idVendor}=="04d8", ATTR{idProduct}=="0057", MODE="0664", GROUP="plugdev"
ATTR{idVendor}=="04d8", ATTR{idProduct}=="0057", RUN="/bin/sh -c 'echo -n $kernel >/sys/bus/usb/drivers/usbhid/unbind'"
ATTR{idVendor}=="04d8", ATTR{idProduct}=="0057", ENV{ID_MM_DEVICE_IGNORE}="1"
ATTR{idVendor}=="04d8", ATTR{idProduct}=="0057", ENV{ID_MM_TTY_BLACKLIST}="1"
ATTR{idVendor}=="04d8", ATTR{idProduct}=="0057", ENV{MTP_NO_PROBE}="1"
ATTR{idVendor}=="04d8", ATTR{idProduct}=="0057", ENV{ID_MM_PORT_IGNORE}="1"
ATTR{idVendor}=="04d8", ATTR{idProduct}=="0057", ENV{ID_MM_TTY_MANUAL_SCAN_ONLY}="1"
```

...then reload and reprocess the device rules: `sudo udevadm control --reload-rules && udevadm trigger`.

-->

<!-- dev works with node 12.13.1, if problems, delete '.cache' directory -->
