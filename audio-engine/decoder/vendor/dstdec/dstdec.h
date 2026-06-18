/*
 * Direct Stream Transfer (DST) decoder
 * Copyright (c) 2014 Peter Ross <pross@xvid.org>
 *
 * This file is part of FFmpeg.
 *
 * FFmpeg is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 *
 * FFmpeg is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with FFmpeg; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA
 */

/*
 * Modifications:
 * - Removed the FFmpeg AVCodecContext/AVFrame/AVPacket integration layer.
 * - Removed the dsd2pcm translation tail so raw DSD bytes remain intact.
 * - Changed output layout to tight DffInterleaved byte packing.
 * - Replaced FFmpeg bitreader helpers with a minimal in-repo MSB-first reader.
 * - Exposed a raw-buffer decode entry point for the Twilight Audio Engine host.
 */

#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace twilight::audio::dstdec {

constexpr int kDstMaxChannels = 6;

size_t frameBytesPerChannelForSampleRate(int sampleRate);

bool decodeFrame(const uint8_t* dstFrameBytes,
                 size_t dstFrameSize,
                 int channels,
                 int sampleRate,
                 uint8_t* dsdOut,
                 size_t dsdOutSize,
                 size_t* bytesWritten,
                 std::string* error);

}  // namespace twilight::audio::dstdec
