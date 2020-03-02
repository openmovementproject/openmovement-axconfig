# AX3 Web Configuration

Use the address: [`config.openmovement.dev`](https://config.openmovement.dev/).

The configuration page will work on browsers that support WebUSB (e.g. *Chrome*), on platforms that have not claimed the devices' serial connection (e.g. Mac, some Android or Linux configurations).  Additional debugging is available in *Chromium*-based browsers at: `chrome://device-log` and `chrome://usb-internals`).

Options can be added to the address by first appending a hash (`#`), then `key=value` pairs separated with an ampersand (`&`):

* `debug` - show debug console information.
* `readonly` - do not allow editing of the detailed settings.
* `nodetails` - hide detailed settings by default.
* `config=123456789` - recording identifier (set as the *subject code* in the metadata; the last 9 digits will also be used as the device's numeric session ID)
<!-- * `session=123456789` - session ID (9 digit numeric, use `config` instead which allows longer, alphanumeric IDs) -->
* `rate=100` - sensor rate (Hz, default `100`, allowed `12.5|25|50|100|200|400|800|1600|3200`)
* `range=8` - sensor range (*g*, default `8`, allowed `2|4|8|16`)
* `start=0` - delay until start from current time (hours, default `0`); or exact start time (`YYYY-MM-DDThh:mm:ss`)
* `stop=168` - duration of recording (hours, default 168); or exact stop time (`YYYY-MM-DDThh:mm:ss`)
* `metadata=` - metadata to add to the recording (use URL-encoded format, `name)

...an example URL with multiple options: `https://config.openmovement.dev/#readonly&nodetails&rate=100&range=8&start=0&stop=168`.  If you wanted to add a *Study Code*, something like this: `https://config.openmovement.dev/#readonly&nodetails&rate=100&range=8&start=0&stop=16&metadata=_s%3dMy_Study_Name`.  And if you also knew the recording identifier, it can be embedded into the link: `https://config.openmovement.dev/#readonly&nodetails&rate=100&range=8&start=0&stop=16&metadata=_s%3dMy_Study_Name&code=123abc456`.

The web application is cached so that it works offline.  If you are using a *Chromium*-based browser and need to force a reload of the application, visit `chrome://appcache-internals/`.



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



<!--
chrome://appcache-internals/

Notes:

* Will not work on Windows, as the device has to be controlled by `WinUSB`
* Does not work over the `file:` protocol -- to fix, for example, use `http-server` and [http://localhost:8080/index.html](http://localhost:8080/index.html)
* Package into library
* Settings string (as URL)
* Download local log of configured devices (optionally clear after download), or send to another server.
* Consider adding camera barcode scan?
* Consider file inspection to detect data
-->

<!--

https://digitalinteraction.github.io/openmovement-axconfig/
https://config.openmovement.dev/

npm run build
-->

<!--

Time of day:
  hh       - exact hour of the day, xx:00:00
  hhmm     - exact minute of the day, xx:xx:00
  hhmmss   - exact time of the day
  ?? h        - relative hour delay 0-9
  ?? hhh      - relative hour delay

Day:
  D        - relative day from today's date 0-9
  DD       - day of the month, next month if more than 14 days ago
  hhh      - day containing the time relative to now plus the specified hours
  MMDD     - month and day, next year if more than 6 months ago
  YYMMDD   - exact date, 20xx year
  YYYYMMDD - exact date

-->


<!--

this.SessionId = sessionId;     // 0
this.Start = start;             // 
this.Duration = duration;       // 24 * 7 * 60 * 60 = 604800
this.Rate = rate;               // 100 (6, 12, 25, 50, 100, 200, 400, 800, 1600, 3200)
this.Range = range;             // 8 (2, 4, 8, 16)


AX3-Deploy Config Strings


        //    20180217091500
        // 14 YYYYMMDDhhmmss
        // 12   YYMMDDhhmmss
        // 10   YYMMDDhhmm
        //  8   YYMMDDhh
        //  6     MMDDhh
        //  4     MMDD
        //  2       DD
        // r=rate (100Hz), g=range (+/-8g), d=duration (hours), b=begin (YYMMDDhh[mm]), s=session (9 digits)
        private long lastInput = 0;
        private bool inputFinished = true;
        public string lastInputString = null;
        public void ForgetLastInput() { lastInputString = null; }

        private DateTime? ParseDateTime(string value)
        {
            DateTime now = DateTime.Now;
            int year = -1;  // auto
            int month = -1; // auto
            int day = -1;   // auto
            int hour = 0;   // default midnight
            int minute = 0; // default o'clock
            int second = 0; // default zero

            if (value == null) { Console.WriteLine("ERROR: Date null"); return null; }
            value = value.Trim().ToLower();
            if (value.Length <= 0) { Console.WriteLine("ERROR: Date empty"); return null; }
            if (value.Length % 2 != 0) { Console.WriteLine("ERROR: Date non-even digits"); return null; } // must be even length
            if (value.Length < 2 || value.Length > 14) { Console.WriteLine("ERROR: Date invalid length"); return null; }

            // Seconds (suffix)
            if (value.Length >= 12)
            {
                second = int.Parse(value.Substring(value.Length - 2));
                value = value.Substring(0, value.Length - 2);
            }

            // Minutes (suffix)
            if (value.Length >= 10)
            {
                minute = int.Parse(value.Substring(value.Length - 2));
                value = value.Substring(0, value.Length - 2);
            }

            // Year (prefix)
            if (value.Length >= 8)
            {
                if (value.Length >= 10)
                {
                    year = int.Parse(value.Substring(0, 4));
                    value = value.Substring(4);
                }
                else
                {
                    year = int.Parse(value.Substring(0, 2)) + 2000;
                    value = value.Substring(2);
                }
            }

            // Hours (suffix)
            if (value.Length >= 6)
            {
                hour = int.Parse(value.Substring(value.Length - 2));
                value = value.Substring(0, value.Length - 2);
            }

            // Months (prefix)
            if (value.Length >= 4)
            {
                month = int.Parse(value.Substring(0, 2));
                value = value.Substring(2);
            }

            // Days (prefix)
            if (value.Length >= 2)
            {
                day = int.Parse(value.Substring(0, 2));
                value = value.Substring(2);
            }

            // Automatic day
            if (day < 0) { day = now.Day; }

            // Automatic month
            if (month < 0) { month = (now.Month + ((day < now.Day) ? 1 : 0) - 1) % 12 + 1; }

            // Automatic year
            if (year < 0) { year = now.Year + ((month < now.Month) ? 1 : 0); }

            try
            {
                return new DateTime(year, month, day, hour, minute, second);
            }
            catch (Exception e)
            {
                Console.WriteLine($"ERROR: Problem constructing date ({e.Message}) for {year}-{month}-{day} {hour}:{minute}:{second}");
                return null;
            }
        }

        public Configuration ParseConfig(string value)
        {
            try
            {
                Configuration configuration = new Configuration();
                if (value == null) { return null; }
                value = value.Trim().ToLower();
                char currentSetting = (char)0;
                string currentValue = "";
                for (int i = 0; i <= value.Length; i++)
                {
                    char c = (i < value.Length) ? value[i] : (char)0;
                    if (c >= '0' && c <= '9')
                    {
                        currentValue += c;
                    }
                    else
                    {
                        if (currentValue.Length > 0)
                        {
                            // Default setting for bare values
                            if (currentSetting == (char)0)
                            {
                                currentSetting = 's';
                            }

                            switch (currentSetting)
                            {
                                case 's':
                                    configuration.SessionId = uint.Parse(currentValue);
                                    break;
                                case 'b':
                                    DateTime? parsedBegin = ParseDateTime(currentValue);
                                    if (!parsedBegin.HasValue)
                                    {
                                        Console.WriteLine("ERROR: Cannot parse begin timestamp: " + currentValue);
                                        return null;
                                    }
                                    configuration.Start = parsedBegin.Value;
                                    break;
                                case 'd':
                                    // Hours to seconds
                                    configuration.Duration = int.Parse(currentValue) * 60 * 60;
                                    break;
                                case 'r':
                                    configuration.Rate = int.Parse(currentValue);
                                    break;
                                case 'g':
                                    configuration.Range = int.Parse(currentValue);
                                    break;
                                default:
                                    Console.WriteLine("ERROR: Unhandled setting: " + currentSetting);
                                    return null;
                            }
                        }
                        currentSetting = c;
                        currentValue = "";
                    }
                }
                return configuration;
            }
            catch (Exception e)
            {
                Console.WriteLine("ERROR: Problem parsing configuration: " + e.Message);
                return null;
            }
        }


-->