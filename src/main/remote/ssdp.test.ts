import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSsdpMSearch,
  extractControlUrlsFromDeviceDescription,
  parseSsdpResponse,
  resolveUpnpUrl
} from './ssdp.ts'

test('buildSsdpMSearch targets MediaRenderer by default', () => {
  const msg = buildSsdpMSearch()
  assert.match(msg, /M-SEARCH \* HTTP\/1\.1/)
  assert.match(msg, /ST: urn:schemas-upnp-org:device:MediaRenderer:1/)
  assert.match(msg, /MX: 2/)
  assert.ok(msg.endsWith('\r\n\r\n') || msg.endsWith('\n\n'))
})

test('parseSsdpResponse extracts location and usn', () => {
  const raw = [
    'HTTP/1.1 200 OK',
    'CACHE-CONTROL: max-age=1800',
    'LOCATION: http://192.168.1.20:1400/xml/device_description.xml',
    'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
    'USN: uuid:RINCON_ABC::urn:schemas-upnp-org:device:MediaRenderer:1',
    'SERVER: Linux UPnP/1.0 Sonos',
    '',
    ''
  ].join('\r\n')
  const parsed = parseSsdpResponse(raw)
  assert.ok(parsed)
  assert.equal(parsed!.statusCode, 200)
  assert.equal(parsed!.location, 'http://192.168.1.20:1400/xml/device_description.xml')
  assert.match(parsed!.usn, /uuid:RINCON_ABC/)
})

test('parseSsdpResponse rejects non-HTTP responses', () => {
  assert.equal(parseSsdpResponse('NOT HTTP'), null)
  assert.equal(parseSsdpResponse('HTTP/1.1 200 OK\r\n\r\n'), null)
})

test('extractControlUrlsFromDeviceDescription finds AVTransport and RenderingControl', () => {
  const xml = `
    <root>
      <device>
        <friendlyName>Living Room</friendlyName>
        <manufacturer>Demo</manufacturer>
        <modelName>Speaker</modelName>
        <serviceList>
          <service>
            <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
            <controlURL>/MediaRenderer/AVTransport/Control</controlURL>
          </service>
          <service>
            <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
            <controlURL>/MediaRenderer/RenderingControl/Control</controlURL>
          </service>
        </serviceList>
      </device>
    </root>
  `
  const meta = extractControlUrlsFromDeviceDescription(xml)
  assert.equal(meta.friendlyName, 'Living Room')
  assert.equal(meta.avTransportUrl, '/MediaRenderer/AVTransport/Control')
  assert.equal(meta.renderingControlUrl, '/MediaRenderer/RenderingControl/Control')
})

test('resolveUpnpUrl resolves relative control URLs against location', () => {
  const absolute = resolveUpnpUrl(
    'http://192.168.1.20:1400/xml/device_description.xml',
    '/MediaRenderer/AVTransport/Control'
  )
  assert.equal(absolute, 'http://192.168.1.20:1400/MediaRenderer/AVTransport/Control')
  assert.equal(resolveUpnpUrl('http://x/', null), null)
})
