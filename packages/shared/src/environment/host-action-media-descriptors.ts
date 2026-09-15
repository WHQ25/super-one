import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import {
  LIST_MEDIA_PROVIDERS_DESCRIPTION,
  GENERATE_IMAGE_DESCRIPTION,
  GENERATE_VIDEO_DESCRIPTION,
  VIDEO_STATUS_DESCRIPTION
} from '../superone-tool-descriptions'

export const HOST_ACTION_MEDIA_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    "name": "media_list_providers",
    "description": LIST_MEDIA_PROVIDERS_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "category": {
          "type": "string",
          "enum": [
            "image",
            "video"
          ],
          "description": "Filter by media category. Omit to list all usable providers."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "media_generate_image",
    "description": GENERATE_IMAGE_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "prompt": {
          "type": "string",
          "description": "A detailed description of the image to generate, or the edit to apply when reference images are provided."
        },
        "provider": {
          "type": "string",
          "description": "Which configured image provider id to use. Call media_list_providers to discover ids. Defaults to the first usable provider."
        },
        "model": {
          "type": "string",
          "description": "Model id override. Defaults to the provider's default model."
        },
        "aspect_ratio": {
          "type": "string",
          "description": "Aspect ratio like \"16:9\" or \"1:1\". Preferred for google models."
        },
        "size": {
          "type": "string",
          "description": "Size for the image. OpenAI: pixel size like \"1024x1024\". Ark: \"2K\"/\"4K\" or \"WxH\". Google Gemini image models: resolution tier \"1K\"/\"2K\"/\"4K\" (or \"512\"); pair with aspect_ratio. Check media_list_providers sizeNote."
        },
        "reference_image_paths": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Absolute paths to input images for editing / image-to-image / iterating on a prior result. Omit for pure text-to-image."
        }
      },
      "required": [
        "prompt"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "media_generate_video",
    "description": GENERATE_VIDEO_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "prompt": {
          "type": "string",
          "description": "A detailed description of the video to generate, including motion and camera direction."
        },
        "provider": {
          "type": "string",
          "description": "Which configured video provider id to use. Call media_list_providers with category \"video\" to discover ids. Defaults to the first usable provider."
        },
        "model": {
          "type": "string",
          "description": "Model id override. Defaults to the provider's default video model."
        },
        "first_frame_path": {
          "type": "string",
          "description": "Absolute path to an image to animate from (image-to-video). This is the starting frame."
        },
        "last_frame_path": {
          "type": "string",
          "description": "Absolute path to an image the video should end on. Requires first_frame_path."
        },
        "reference_image_paths": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Absolute paths to reference images for character or scene consistency. Up to 9 images total across all roles on Ark."
        },
        "reference_video_paths": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Absolute paths to reference video clips. Volcengine Ark (Seedance) only; ignored by other providers."
        },
        "reference_audio_paths": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Absolute paths to reference audio tracks. Volcengine Ark (Seedance) only; ignored by other providers."
        },
        "aspect_ratio": {
          "type": "string",
          "description": "Aspect ratio like \"16:9\", \"9:16\" or \"1:1\"."
        },
        "resolution": {
          "type": "string",
          "description": "Pixel resolution like \"1920x1080\" or \"1280x720\". Ark maps this onto its 480p/720p/1080p tiers; Sora accepts only 720x1280, 1280x720, 1024x1792, 1792x1024."
        },
        "duration": {
          "type": "number",
          "description": "Clip length in seconds. Ark accepts 2-15; Sora accepts only 4, 8 or 12."
        },
        "fps": {
          "type": "number",
          "description": "Frames per second, e.g. 24. Ignored by providers that derive it from the model."
        },
        "seed": {
          "type": "number",
          "description": "Seed for reproducible generation."
        },
        "generate_audio": {
          "type": "boolean",
          "description": "Whether the model should generate a soundtrack alongside the video, where supported."
        },
        "watermark": {
          "type": "boolean",
          "description": "Whether to stamp the provider watermark. Volcengine Ark only."
        },
        "camera_fixed": {
          "type": "boolean",
          "description": "Lock the camera in place instead of letting the model move it. Volcengine Ark only."
        }
      },
      "required": [
        "prompt"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "media_video_status",
    "description": VIDEO_STATUS_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "generation_id": {
          "type": "string",
          "description": "The generationId returned by media_generate_video."
        }
      },
      "required": [
        "generation_id"
      ],
      "additionalProperties": false
    }
  }
]
