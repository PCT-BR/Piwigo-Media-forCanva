import { useFeatureSupport } from "@canva/app-hooks";
import {
  Box,
  Button,
  FormField,
  Grid,
  ImageCard,
  Rows,
  Select,
  Text,
  TextInput,
  Title,
} from "@canva/app-ui-kit";
import { upload } from "@canva/asset";
import {
  addElementAtCursor,
  addElementAtPoint,
  requestExport,
} from "@canva/design";
import { requestOpenExternalUrl } from "@canva/platform";
import { useEffect, useMemo, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import * as styles from "styles/components.css";

const STORAGE_KEY = "piwigo-media-connector";
const CONNECTOR_DOWNLOAD_URL =
  "https://github.com/PCT-BR/Canvaconnector-for-piwigo";

type ConnectionState = {
  connected: boolean;
  piwigoBaseUrl?: string;
  tokenLabel?: string;
};

type StoredConnection = {
  piwigoBaseUrl: string;
  connectorToken: string;
};

type Album = {
  id: number;
  name: string;
  parentId: number | null;
  directImages: number;
  totalImages: number;
  isPrivate: boolean;
};

type Photo = {
  id: number;
  title: string;
  filename: string;
  mimeType: "image/jpeg" | "image/png";
  thumbUrl: string;
  previewUrl: string;
  assetUrl: string;
};

type ApiState = "idle" | "loading" | "saving" | "exporting" | "uploading";

function normalizePiwigoUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function connectorApiBase(piwigoBaseUrl: string) {
  return `${normalizePiwigoUrl(piwigoBaseUrl)}/plugins/canva_connector/api`;
}

function connectorPageUrl(piwigoBaseUrl: string) {
  return `${normalizePiwigoUrl(piwigoBaseUrl)}/plugins/canva_connector/connect.php`;
}

function loadStoredConnection(): StoredConnection | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredConnection) : null;
  } catch {
    return null;
  }
}

function saveStoredConnection(connection: StoredConnection) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
}

function clearStoredConnection() {
  window.localStorage.removeItem(STORAGE_KEY);
}

async function readJsonResponse<T>(res: Response) {
  const text = await res.text();
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  const starts = [firstBrace, firstBracket].filter((index) => index >= 0);
  const jsonStart = starts.length > 0 ? Math.min(...starts) : -1;
  const jsonEnd = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));

  if (jsonStart < 0 || jsonEnd < jsonStart) {
    throw new Error(text.slice(0, 180) || `HTTP ${res.status}`);
  }

  try {
    return JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as T & {
      error?: string;
    };
  } catch {
    throw new Error(text.slice(0, 240) || `HTTP ${res.status}`);
  }
}

async function imageUrlToDataUrl(
  url: string,
  token: string,
  fallbackMimeType: Photo["mimeType"],
) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Image download returned HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const mimeType = blob.type || fallbackMimeType;

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read image data"));
    reader.readAsDataURL(new Blob([blob], { type: mimeType }));
  });
}

export const App = () => {
  const intl = useIntl();
  const [state, setState] = useState<ApiState>("idle");
  const [error, setError] = useState<string | undefined>();
  const [connection, setConnection] = useState<ConnectionState>({
    connected: false,
  });
  const [piwigoBaseUrl, setPiwigoBaseUrl] = useState("");
  const [connectorToken, setConnectorToken] = useState("");
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | undefined>();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [lastMessage, setLastMessage] = useState<string | undefined>();

  const isSupported = useFeatureSupport();
  const addElement = [addElementAtPoint, addElementAtCursor].find((fn) =>
    isSupported(fn),
  );

  const albumOptions = useMemo(() => {
    const byId = new Map(albums.map((album) => [album.id, album]));

    function albumPath(album: Album) {
      const names = [album.name];
      const visited = new Set<number>([album.id]);
      let parentId = album.parentId;
      while (parentId && !visited.has(parentId)) {
        const parent = byId.get(parentId);
        if (!parent) break;
        names.unshift(parent.name);
        visited.add(parent.id);
        parentId = parent.parentId;
      }
      return names.join(" > ");
    }

    return albums.map((album) => {
      const count =
        album.directImages === album.totalImages
          ? `${album.totalImages}`
          : intl.formatMessage(
              {
                defaultMessage: "{directImages} direct / {totalImages} total",
                description:
                  "Album image counts shown in the album selector when direct and total image counts differ.",
              },
              {
                directImages: album.directImages,
                totalImages: album.totalImages,
              },
            );
      return {
        value: String(album.id),
        // Album names come from the user's Piwigo instance; only the count suffix is app UI.
        // eslint-disable-next-line formatjs/no-literal-string-in-object
        label: `${albumPath(album)} (${count})`,
      };
    });
  }, [albums, intl]);

  async function connectorFetch<T>(path: string, init: RequestInit = {}) {
    const baseUrl = normalizePiwigoUrl(piwigoBaseUrl);
    const res = await fetch(`${connectorApiBase(baseUrl)}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${connectorToken}`,
        ...init.headers,
      },
    });
    const body = await readJsonResponse<T>(res);
    if (!res.ok) {
      throw new Error(
        body.error ||
          intl.formatMessage(
            {
              defaultMessage: "Piwigo Connector returned HTTP {status}",
              description:
                "Error shown when the Piwigo Connector API returns an unexpected HTTP status.",
            },
            { status: res.status },
          ),
      );
    }
    return body;
  }

  async function openConnector() {
    const url = connectorPageUrl(piwigoBaseUrl);
    const response = await requestOpenExternalUrl({ url });
    if (response.status === "aborted") {
      setLastMessage(
        intl.formatMessage({
          defaultMessage: "Connection page was not opened.",
          description:
            "Message shown when the user cancels opening the Piwigo Connector page.",
        }),
      );
    }
  }

  async function openConnectorDownload() {
    await requestOpenExternalUrl({ url: CONNECTOR_DOWNLOAD_URL });
  }

  async function testAndSaveConnection(input?: StoredConnection) {
    const previousUrl = piwigoBaseUrl;
    const previousToken = connectorToken;
    const nextUrl = normalizePiwigoUrl(input?.piwigoBaseUrl || piwigoBaseUrl);
    const nextToken = input?.connectorToken || connectorToken;

    setState("saving");
    setError(undefined);
    setLastMessage(undefined);
    setPiwigoBaseUrl(nextUrl);
    setConnectorToken(nextToken);

    try {
      const res = await fetch(`${connectorApiBase(nextUrl)}/status.php`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${nextToken}`,
        },
      });
      const data = await readJsonResponse<ConnectionState>(res);
      if (!res.ok) {
        throw new Error(
          data.error || `Piwigo Connector returned HTTP ${res.status}`,
        );
      }

      const stored = { piwigoBaseUrl: nextUrl, connectorToken: nextToken };
      saveStoredConnection(stored);
      setConnection(data);
      setLastMessage(
        intl.formatMessage({
          defaultMessage: "Connected to the Piwigo Connector.",
          description:
            "Confirmation shown after successfully connecting to the Piwigo Connector.",
        }),
      );
      await loadAlbums(stored);
    } catch (err) {
      setPiwigoBaseUrl(previousUrl);
      setConnectorToken(previousToken);
      setConnection({ connected: false });
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              defaultMessage: "Connection failed.",
              description:
                "Error shown when the user cannot connect their Piwigo Connector.",
            }),
      );
    } finally {
      setState("idle");
    }
  }

  async function disconnect() {
    clearStoredConnection();
    setConnection({ connected: false });
    setAlbums([]);
    setPhotos([]);
    setSelectedAlbumId(undefined);
    setConnectorToken("");
    setLastMessage(undefined);
  }

  async function loadAlbums(input?: StoredConnection) {
    const baseUrl = input?.piwigoBaseUrl || piwigoBaseUrl;
    const token = input?.connectorToken || connectorToken;
    const data = await fetch(`${connectorApiBase(baseUrl)}/albums.php`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const albumsData = await readJsonResponse<Album[]>(data);
    if (!data.ok) {
      throw new Error(
        albumsData.error || `Piwigo Connector returned HTTP ${data.status}`,
      );
    }

    setAlbums(albumsData);
    if (!selectedAlbumId && albumsData.length > 0) {
      const firstAlbum = albumsData[0];
      if (firstAlbum) {
        setSelectedAlbumId(String(firstAlbum.id));
        await loadPhotos(String(firstAlbum.id), input);
      }
    }
  }

  async function loadPhotos(albumId: string, input?: StoredConnection) {
    setSelectedAlbumId(albumId);
    setState("loading");
    setError(undefined);
    try {
      const baseUrl = input?.piwigoBaseUrl || piwigoBaseUrl;
      const token = input?.connectorToken || connectorToken;
      const res = await fetch(
        `${connectorApiBase(baseUrl)}/photos.php?albumId=${encodeURIComponent(albumId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await readJsonResponse<{ photos: Photo[] }>(res);
      if (!res.ok) {
        throw new Error(
          data.error || `Piwigo Connector returned HTTP ${res.status}`,
        );
      }
      setPhotos(data.photos);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              defaultMessage: "Unable to load photos.",
              description:
                "Error shown when photos cannot be loaded from a Piwigo album.",
            }),
      );
    } finally {
      setState("idle");
    }
  }

  async function insertPhoto(photo: Photo) {
    if (!addElement) {
      setError(
        intl.formatMessage({
          defaultMessage:
            "Image insertion is not available in this Canva context.",
          description:
            "Error shown when Canva does not support inserting an image in the current design context.",
        }),
      );
      return;
    }

    setState("loading");
    setError(undefined);
    try {
      const dataUrl = await imageUrlToDataUrl(
        photo.assetUrl,
        connectorToken,
        photo.mimeType,
      );
      const { ref } = await upload({
        type: "image",
        mimeType: photo.mimeType,
        url: dataUrl,
        thumbnailUrl: dataUrl,
        name: photo.title || photo.filename,
        aiDisclosure: "none",
      });
      await addElement({
        type: "image",
        ref,
        altText: {
          text: photo.title || photo.filename || "Piwigo image",
          decorative: false,
        },
      });
      setLastMessage(
        intl.formatMessage({
          defaultMessage: "Image added to the design.",
          description:
            "Confirmation shown after inserting a Piwigo image into the Canva design.",
        }),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              defaultMessage: "Unable to insert the image.",
              description:
                "Error shown when a Piwigo image cannot be inserted into Canva.",
            }),
      );
    } finally {
      setState("idle");
    }
  }

  async function exportToPiwigo() {
    if (!selectedAlbumId) return;

    setError(undefined);
    setLastMessage(undefined);
    setState("exporting");
    try {
      const result = await requestExport({ acceptedFileTypes: ["jpg", "png"] });
      if (result.status !== "completed") {
        setLastMessage(
          intl.formatMessage({
            defaultMessage: "Export canceled.",
            description:
              "Message shown when the user cancels the Canva export.",
          }),
        );
        return;
      }

      setState("uploading");
      await connectorFetch("/upload.php", {
        method: "POST",
        body: JSON.stringify({
          canvaExportUrl: result.exportBlobs[0]?.url,
          albumId: selectedAlbumId,
          filename: result.title,
        }),
      });
      setLastMessage(
        intl.formatMessage({
          defaultMessage: "Design saved to Piwigo.",
          description:
            "Confirmation shown after exporting a Canva design to Piwigo.",
        }),
      );
      await loadPhotos(selectedAlbumId);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              defaultMessage: "Unable to export the design.",
              description:
                "Error shown when the Canva design cannot be exported to Piwigo.",
            }),
      );
    } finally {
      setState("idle");
    }
  }

  useEffect(() => {
    const stored = loadStoredConnection();
    if (!stored) return;

    setPiwigoBaseUrl(stored.piwigoBaseUrl);
    setConnectorToken(stored.connectorToken);
    void testAndSaveConnection(stored);
  }, []);

  if (!connection.connected) {
    return (
      <div className={styles.scrollContainer}>
        <Rows spacing="2u">
          <Title size="small">
            <FormattedMessage
              defaultMessage="Connect Piwigo"
              description="Title of the Piwigo connection screen."
            />
          </Title>
          <Text>
            <FormattedMessage
              defaultMessage="Install the connector in Piwigo, open it from here, authorize Canva, copy the connector token, then paste it below."
              description="Explanation shown before the user connects their Piwigo Connector."
            />
          </Text>
          <Button variant="secondary" stretch onClick={openConnectorDownload}>
            {intl.formatMessage({
              defaultMessage: "Download Piwigo Connector",
              description:
                "Button label to open the Piwigo Connector download page.",
            })}
          </Button>
          <FormField
            label={intl.formatMessage({
              defaultMessage: "Piwigo URL",
              description: "Label for the Piwigo instance URL input.",
            })}
            value={piwigoBaseUrl}
            control={(props) => (
              <TextInput
                {...props}
                placeholder={intl.formatMessage({
                  defaultMessage: "https://photos.example.com",
                  description:
                    "Placeholder example for the Piwigo instance URL input.",
                })}
                onChange={setPiwigoBaseUrl}
              />
            )}
          />
          <Button
            variant="secondary"
            stretch
            disabled={!piwigoBaseUrl}
            onClick={openConnector}
          >
            {intl.formatMessage({
              defaultMessage: "Open Piwigo Connector",
              description:
                "Button label to open the Piwigo Connector token page.",
            })}
          </Button>
          <FormField
            label={intl.formatMessage({
              defaultMessage: "Connector token",
              description: "Label for the Piwigo Connector token input.",
            })}
            value={connectorToken}
            control={(props) => (
              <TextInput {...props} onChange={setConnectorToken} />
            )}
          />
          {error && <Text tone="critical">{error}</Text>}
          {lastMessage && <Text tone="primary">{lastMessage}</Text>}
          <Button
            variant="primary"
            stretch
            loading={state === "saving"}
            disabled={!piwigoBaseUrl || !connectorToken}
            onClick={() => void testAndSaveConnection()}
          >
            {intl.formatMessage({
              defaultMessage: "Test and save",
              description:
                "Button label to test and save the Piwigo connection.",
            })}
          </Button>
        </Rows>
      </div>
    );
  }

  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="2u">
        <Rows spacing="0.5u">
          <Title size="small">
            <FormattedMessage
              defaultMessage="Piwigo Media"
              description="Title of the connected Piwigo media browser."
            />
          </Title>
          <Text>
            <FormattedMessage
              defaultMessage="Connected to {url}"
              description="Status text showing the connected Piwigo URL."
              values={{ url: connection.piwigoBaseUrl || piwigoBaseUrl }}
            />
          </Text>
        </Rows>

        <FormField
          label={intl.formatMessage({
            defaultMessage: "Album",
            description: "Label for the Piwigo album selector.",
          })}
          value={selectedAlbumId}
          control={(props) => (
            <Select
              {...props}
              stretch
              options={albumOptions}
              onChange={(value) => void loadPhotos(value)}
            />
          )}
        />

        <Button
          variant="primary"
          stretch
          loading={state === "exporting" || state === "uploading"}
          disabled={!selectedAlbumId}
          onClick={exportToPiwigo}
        >
          {intl.formatMessage({
            defaultMessage: "Save design to this album",
            description:
              "Button label to export the current Canva design to the selected Piwigo album.",
          })}
        </Button>
        <Button variant="secondary" stretch onClick={disconnect}>
          {intl.formatMessage({
            defaultMessage: "Disconnect",
            description:
              "Button label to remove the saved Piwigo Connector token from Canva.",
          })}
        </Button>

        {lastMessage && <Text tone="primary">{lastMessage}</Text>}
        {error && <Text tone="critical">{error}</Text>}

        <Box paddingTop="1u">
          <Grid columns={2} spacing="1u">
            {photos.map((photo) => (
              <ImageCard
                key={photo.id}
                ariaLabel={intl.formatMessage(
                  {
                    defaultMessage: "Add {name}",
                    description:
                      "Accessible label for adding a Piwigo photo to the design.",
                  },
                  { name: photo.title || photo.filename },
                )}
                alt={photo.title || photo.filename}
                thumbnailUrl={`${photo.thumbUrl}&token=${encodeURIComponent(connectorToken)}`}
                onClick={() => void insertPhoto(photo)}
                borderRadius="standard"
              />
            ))}
          </Grid>
        </Box>

        {photos.length === 0 && state !== "loading" && (
          <Text>
            <FormattedMessage
              defaultMessage="No photos directly in this album. If it is a parent folder, choose a sub-album."
              description="Empty state shown when a selected Piwigo album has no direct photos."
            />
          </Text>
        )}
      </Rows>
    </div>
  );
};
