using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using NAudio.Wave;

namespace DshInterpretAudioCapture
{
    internal static class Program
    {
        private static readonly object Gate = new object();
        private static readonly List<byte> Pending = new List<byte>();
        private static string outputDir;
        private static int sampleRate;
        private static int channels;
        private static int chunkBytes;
        private static long sequence;
        private static WasapiLoopbackCapture capture;

        private static int Main(string[] args)
        {
            try
            {
                Parse(args);
                Directory.CreateDirectory(outputDir);
                capture = new WasapiLoopbackCapture();
                WaveFormat format = capture.WaveFormat;
                sampleRate = format.SampleRate;
                channels = format.Channels;
                chunkBytes = Math.Max(320, (int)Math.Round(sampleRate * channels * 2 * chunkSecondsValue));
                Console.Error.WriteLine("capture format: " + format);
                var done = new ManualResetEventSlim(false);
                capture.DataAvailable += OnData;
                capture.RecordingStopped += (sender, eventArgs) =>
                {
                    if (eventArgs.Exception != null) Console.Error.WriteLine(eventArgs.Exception);
                    done.Set();
                };
                Console.CancelKeyPress += (sender, eventArgs) =>
                {
                    eventArgs.Cancel = true;
                    done.Set();
                };
                capture.StartRecording();
                done.Wait();
                try { capture.StopRecording(); } catch { }
                FlushPending();
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("capture failed: " + error);
                return 1;
            }
            finally
            {
                try { capture?.Dispose(); } catch { }
            }
        }

        private static void Parse(string[] args)
        {
            outputDir = null;
            var chunkSeconds = 1.0;
            for (var i = 0; i < args.Length; i++)
            {
                var arg = args[i];
                var value = i + 1 < args.Length ? args[i + 1] : null;
                if ((arg == "--output-dir" || arg == "--out") && value != null) { outputDir = value; i++; }
                else if (arg.StartsWith("--output-dir=", StringComparison.Ordinal)) outputDir = arg.Substring("--output-dir=".Length);
                else if (arg == "--chunk-size" && value != null) { chunkSeconds = Math.Max(0.25, double.Parse(value)); i++; }
                else if (arg == "--help" || arg == "-h") { Console.WriteLine("dsh-asr-capture-system --output-dir DIR"); Environment.Exit(0); }
            }
            if (string.IsNullOrWhiteSpace(outputDir))
                throw new ArgumentException("--output-dir is required");
            if (chunkSeconds > 10) chunkSeconds = 10;
            // chunkBytes is finalized after the capture format is known.
            chunkSecondsValue = chunkSeconds;
        }

        private static double chunkSecondsValue = 1.0;

        private static void OnData(object sender, WaveInEventArgs eventArgs)
        {
            if (eventArgs.BytesRecorded <= 0) return;
            var pcm = ToPcm16(eventArgs.Buffer, eventArgs.BytesRecorded);
            if (pcm.Length == 0) return;
            lock (Gate)
            {
                Pending.AddRange(pcm);
                while (Pending.Count >= chunkBytes)
                {
                    var chunk = new byte[chunkBytes];
                    Pending.CopyTo(0, chunk, 0, chunkBytes);
                    Pending.RemoveRange(0, chunkBytes);
                    WriteChunk(chunk);
                }
            }
        }

        private static byte[] ToPcm16(byte[] buffer, int bytes)
        {
            var format = capture.WaveFormat;
            if (format.BitsPerSample == 16)
            {
                var copy = new byte[bytes];
                Buffer.BlockCopy(buffer, 0, copy, 0, bytes);
                return copy;
            }
            if (format.BitsPerSample == 32)
            {
                var count = bytes / 4;
                var result = new byte[count * 2];
                for (var i = 0; i < count; i++)
                {
                    // WASAPI loopback is IEEE float; treating 32-bit data as float
                    // also covers extensible formats whose Encoding is not IeeeFloat.
                    float value = BitConverter.ToSingle(buffer, i * 4);
                    if (float.IsNaN(value) || float.IsInfinity(value)) value = 0f;
                    value = Math.Max(-1f, Math.Min(1f, value));
                    var sample = (short)Math.Round(value * 32767f);
                    result[i * 2] = (byte)(sample & 0xff);
                    result[i * 2 + 1] = (byte)((sample >> 8) & 0xff);
                }
                return result;
            }
            throw new NotSupportedException("unsupported capture format: " + format);
        }

        private static void WriteChunk(byte[] pcm)
        {
            var stamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var id = Interlocked.Increment(ref sequence);
            var name = stamp + "-" + id + "-system.wav";
            var path = Path.Combine(outputDir, name);
            using (var writer = new WaveFileWriter(path, new WaveFormat(sampleRate, 16, channels)))
                writer.Write(pcm, 0, pcm.Length);
        }

        private static void FlushPending()
        {
            lock (Gate)
            {
                if (Pending.Count > 0 && chunkBytes > 0)
                {
                    var chunk = Pending.ToArray();
                    Pending.Clear();
                    WriteChunk(chunk);
                }
            }
        }
    }
}
