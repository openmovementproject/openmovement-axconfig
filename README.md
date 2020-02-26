# AX3 Web Configuration


<!--
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