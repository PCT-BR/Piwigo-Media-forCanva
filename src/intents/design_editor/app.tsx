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
import { useEffect, useMemo, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import * as styles from "styles/components.css";

const STORAGE_KEY = "piwigo-media-connector";
const CONNECTOR_DOWNLOAD_URL =
  "https://github.com/PCT-BR/Canvaconnector-for-piwigo";
const FALLBACK_THUMBNAIL_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='240' viewBox='0 0 320 240'%3E%3Crect width='320' height='240' fill='%23edf0f2'/%3E%3Cpath d='M108 156l34-38 26 29 18-20 38 43H96z' fill='%23b8c1cc'/%3E%3Ccircle cx='213' cy='86' r='18' fill='%23b8c1cc'/%3E%3C/svg%3E";
const PHOTOS_PER_PAGE = 24;
const THUMBNAIL_HYDRATION_CONCURRENCY = 4;

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
  assetMimeType?: "image/jpeg" | "image/png" | "image/webp";
  thumbUrl: string;
  previewUrl: string;
  assetUrl: string;
  fullUrl?: string;
  thumbnailDataUrl?: string;
};

type PhotosResponse = {
  photos: Photo[];
  total?: number;
  page?: number;
  perPage?: number;
  per_page?: number;
};

type ApiState =
  | "idle"
  | "loading"
  | "loadingMore"
  | "saving"
  | "exporting"
  | "uploading";

const imageDataUrlCache = new Map<string, string>();

function normalizePiwigoUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function connectorApiBase(piwigoBaseUrl: string) {
  return `${normalizePiwigoUrl(piwigoBaseUrl)}/plugins/canva_connector/api`;
}

function connectorPageUrl(piwigoBaseUrl: string) {
  return `${normalizePiwigoUrl(piwigoBaseUrl)}/plugins/canva_connector/connect.php`;
}

function isSignedMediaUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.has("sig") && parsed.searchParams.has("expires");
  } catch {
    return false;
  }
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
  token: string | undefined,
  fallbackMimeType: string,
) {
  const cacheKey = `${token || ""}:${url}`;
  const cached = imageDataUrlCache.get(cacheKey);
  if (cached) return cached;

  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Image download returned HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const mimeType = blob.type || fallbackMimeType;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read image data"));
    reader.readAsDataURL(new Blob([blob], { type: mimeType }));
  });

  imageDataUrlCache.set(cacheKey, dataUrl);
  return dataUrl;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
) {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(limit, queue.length) },
    async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item) {
          await task(item);
        }
      }
    },
  );
  await Promise.all(workers);
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
  const [photosPage, setPhotosPage] = useState(0);
  const [photosTotal, setPhotosTotal] = useState<number | undefined>();
  const [hasMorePhotos, setHasMorePhotos] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | undefined>();
  const photosRequestId = useRef(0);

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

  const selectedAlbum = useMemo(
    () =>
      selectedAlbumId
        ? albums.find((album) => String(album.id) === selectedAlbumId)
        : undefined,
    [albums, selectedAlbumId],
  );

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
    setPhotosPage(0);
    setPhotosTotal(undefined);
    setHasMorePhotos(false);
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

  async function loadPhotos(
    albumId: string,
    input?: StoredConnection,
    options: { append?: boolean; page?: number } = {},
  ) {
    const append = options.append === true;
    const page = options.page || 1;
    const requestId = append
      ? photosRequestId.current
      : photosRequestId.current + 1;
    photosRequestId.current = requestId;
    setSelectedAlbumId(albumId);
    setState(append ? "loadingMore" : "loading");
    setError(undefined);
    if (!append) {
      setPhotos([]);
      setPhotosPage(0);
      setPhotosTotal(undefined);
      setHasMorePhotos(false);
    }
    try {
      const baseUrl = input?.piwigoBaseUrl || piwigoBaseUrl;
      const token = input?.connectorToken || connectorToken;
      const query = new URLSearchParams({
        albumId,
        page: String(page),
        perPage: String(PHOTOS_PER_PAGE),
        per_page: String(PHOTOS_PER_PAGE),
      });
      const res = await fetch(
        `${connectorApiBase(baseUrl)}/photos.php?${query.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await readJsonResponse<PhotosResponse>(res);
      if (!res.ok) {
        throw new Error(
          data.error || `Piwigo Connector returned HTTP ${res.status}`,
        );
      }

      if (requestId !== photosRequestId.current) return;

      const responsePerPage = data.perPage || data.per_page || PHOTOS_PER_PAGE;
      const responsePage = data.page || page;
      const expectedTotal = data.total ?? selectedAlbum?.directImages;
      const pagePhotos = data.photos;
      const previousPhotos = append ? photos : [];
      const previousPhotoIds = new Set(previousPhotos.map((photo) => photo.id));
      const newPhotos = append
        ? pagePhotos.filter((photo) => !previousPhotoIds.has(photo.id))
        : pagePhotos;
      const shownCount = previousPhotos.length + newPhotos.length;

      setPhotos((currentPhotos) => {
        return append ? [...currentPhotos, ...newPhotos] : newPhotos;
      });
      setPhotosPage(responsePage);
      setPhotosTotal(expectedTotal);
      setHasMorePhotos(
        append && newPhotos.length === 0
          ? false
          : typeof expectedTotal === "number"
            ? append
              ? shownCount < expectedTotal
              : newPhotos.length < expectedTotal
            : newPhotos.length >= responsePerPage,
      );
      const protectedThumbnails = newPhotos.filter(
        (photo) => !isSignedMediaUrl(photo.thumbUrl),
      );
      void hydrateThumbnailsProgressively(
        protectedThumbnails,
        token,
        requestId,
      );
    } catch (err) {
      if (requestId !== photosRequestId.current) return;
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
      if (requestId === photosRequestId.current) {
        setState("idle");
      }
    }
  }

  async function loadMorePhotos() {
    if (!selectedAlbumId || state === "loadingMore") return;
    await loadPhotos(selectedAlbumId, undefined, {
      append: true,
      page: photosPage + 1,
    });
  }

  async function hydrateThumbnailsProgressively(
    photosToHydrate: Photo[],
    token: string,
    requestId: number,
  ) {
    await runWithConcurrency(
      photosToHydrate,
      THUMBNAIL_HYDRATION_CONCURRENCY,
      async (photo) => {
        try {
          const thumbnailDataUrl = await imageUrlToDataUrl(
            photo.thumbUrl,
            token,
            photo.mimeType,
          );
          if (requestId !== photosRequestId.current) return;

          setPhotos((currentPhotos) =>
            currentPhotos.map((currentPhoto) =>
              currentPhoto.id === photo.id
                ? { ...currentPhoto, thumbnailDataUrl }
                : currentPhoto,
            ),
          );
        } catch {
          // Keep the fallback placeholder if the protected thumbnail cannot be fetched.
        }
      },
    );
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
      const uploadMimeType = photo.assetMimeType || photo.mimeType;
      const dataUrl = await imageUrlToDataUrl(
        photo.assetUrl,
        isSignedMediaUrl(photo.assetUrl) ? undefined : connectorToken,
        uploadMimeType,
      );
      const { ref } = await upload({
        type: "image",
        mimeType: uploadMimeType,
        url: dataUrl,
        thumbnailUrl: photo.thumbnailDataUrl || dataUrl,
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

        {photos.length > 0 && (
          <Text>
            {typeof photosTotal === "number"
              ? intl.formatMessage(
                  {
                    defaultMessage: "Showing {shown} of {total} photos.",
                    description:
                      "Status text showing how many Piwigo photos are currently loaded from the selected album.",
                  },
                  { shown: photos.length, total: photosTotal },
                )
              : intl.formatMessage(
                  {
                    defaultMessage: "Showing {shown} photos.",
                    description:
                      "Status text shown when the total number of Piwigo photos is unknown.",
                  },
                  { shown: photos.length },
                )}
          </Text>
        )}

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
                thumbnailUrl={
                  photo.thumbnailDataUrl ||
                  (isSignedMediaUrl(photo.thumbUrl)
                    ? photo.thumbUrl
                    : FALLBACK_THUMBNAIL_URL)
                }
                onClick={() => void insertPhoto(photo)}
                borderRadius="standard"
              />
            ))}
          </Grid>
        </Box>

        {hasMorePhotos && (
          <Button
            variant="secondary"
            stretch
            loading={state === "loadingMore"}
            disabled={state === "loading" || state === "loadingMore"}
            onClick={() => void loadMorePhotos()}
          >
            {intl.formatMessage({
              defaultMessage: "Load more photos",
              description:
                "Button label to load the next page of Piwigo photos.",
            })}
          </Button>
        )}

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
