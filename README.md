# AX Device Web Configuration Tool

This is a web-based configuration tool for [AX Devices](https://github.com/digitalinteraction/openmovement/wiki/AX3), and is part of the [Open Movement](https://openmovement.dev/) project.

To configure a device:

1. Visit the address: [`config.openmovement.dev`](https://config.openmovement.dev/)

2. Connect the device.  You may only configure one device at a time.  If on a mobile phone or tablet, you may need a special adapter or cable from your mobile USB Micro-B female, or USB C female port, to the device's USB Micro-B female port. 

3. Choose *Connect USB device...* on Android/Mac, or *Connect Serial device...* on Windows (if this option does not appear, see below for how to enable it).

4. Select your device and click *Connect*.

5. Enter your configuration *Code* (which will be used to identify the recording).

6. Check that the details of the recording configuration are correct.  If you use the same details for multiple devices, consider altering the URL as described below and bookmarking the page to fix these values.

7. Verify that the device's current state and battery level is suitable, then select *Configure* to program the device.



## How it communicates

The AX devices are a *Composite USB Device* made up of a *USB Mass Storage Device Class* (to serve the data file, like a standard USB drive), and a *USB Communications Device Class (CDC)* (a serial device).  To configure the devices the tool must communicate with the CDC device from the web page. 

On some platforms (e.g. Mac and on some Android devices), the CDC connection is available as a standard USB interface and communication is possible on supported browsers via *WebUSB*.  Additional debugging may be available in your browser at: `chrome://device-log` and `chrome://usb-internals`. 

However, on other platforms, the CDC device is taken by a standard serial driver (e.g. for example, some Android devices as `/dev/ttyACM*`, on Windows as `\\.\COM*`).  There is a second communication approach that supports serial connections, the *Web Serial API*, and this should work on some supported browsers (e.g. Chrome on Windows), but may require enabling at `chrome://flags#enable-experimental-web-platform-features`. 

Unfortunately, Android is not a supported platform for the *Web Serial API* and, worse, access to serial devices (`/dev/ttyACM*`) appears to be completely forbidden to all applications on some devices (via a Security-Enhanced Linux configuration). 
To get around this limitation, there is an [experimental AX3 device firmware V50 with WinUSB and Generic interface support](https://raw.githubusercontent.com/digitalinteraction/openmovement/master/Downloads/AX3/AX3-Firmware-50-winusb-generic.zip] -- this firmware supports an additional "generic" interface for device communication (which does not appear to be a serial CDC device) and, in addition, supports the WinUSB descriptors which allows the interface to be visible to user applications.

<!--
An additional method is to use a local native binary for device communication, either through a WebExtension using Native Messaging, and/or by running a local server over HTTP(S)/WebSocket.
-->


## URL-based options

Options can be added to the address by first appending a hash (`#`), then `key=value` pairs separated with an ampersand (`&`):

* `debug` - show debug console information.
* `readonly` - do not allow editing of the detailed settings.
* `nodetails` - hide detailed settings by default.
* `config=123456789` - recording identifier (set as the *subject code* in the metadata; the last 9 digits will also be used as the device's numeric session ID)
<!-- * `session=123456789` - session ID (9 digit numeric; use `config` instead which allows longer alphanumeric IDs stored in the *subject code*) -->
* `rate=100` - sensor rate (Hz, default `100`, allowed `12.5|25|50|100|200|400|800|1600|3200`)
* `range=8` - sensor range (*g*, default `8`, allowed `2|4|8|16`)
* `gyro=0` - gyro sensitivity (*dps*, default `0`=none, allowed `250|500|1000|2000`)
* `start=0` - delay until start from current time (hours, default `0`); or exact start time (`YYYY-MM-DDThh:mm:ss`)
* `stop=168` - duration of recording (hours, default 168); or exact stop time (`YYYY-MM-DDThh:mm:ss`)
* `metadata=` - metadata to add to the recording (use URL-encoded format which will need double-escaping in a URL; subject code `_sc` will be added from the `config` value)

...an example URL with multiple options: `https://config.openmovement.dev/#readonly&nodetails&rate=100&range=8&start=0&stop=168`.  If you wanted to add a *Study Code*, something like this: `https://config.openmovement.dev/#readonly&nodetails&rate=100&range=8&start=0&stop=168&metadata=_s%3dMy_Study_Name`.  And if you also knew the recording identifier, it can be embedded into the link: `https://config.openmovement.dev/#readonly&nodetails&rate=100&range=8&start=0&stop=168&metadata=_s%3dMy_Study_Name&code=123abc456`.


## Offline

The web application is cached so that it works offline.  In Chrome-based browsers, see `chrome://serviceworker-internals` (or `chrome://appcache-internals/` for earlier versions of this application).  The application is also a *Progressive Web App* and can be installed to the user's desktop/home screen/launcher.


## Configuration Logs

Logs are stored locally in the browser.  The following options affect the logs: `nolog`, remove log buttons; `nologclear`, remove *Clear Log* button.  When *Download Log* is clicked, the downloaded log file is in *.CSV* format. Times are local and in the format `YYYY-MM-DD hh:mm:ss`. The *type* reports success/failure and is `AX3-CONFIG-OK`/`AX3-CONFIG-FAILURE` (final configuration check did not match)/`AX3-CONFIG-ERROR` (or `AX6-` prefixed). The line format is:

```
time,type,deviceId,sessionId,start,stop,frequency,range,"metadata",gyroRange,"subjectCode"
```

<!--

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
