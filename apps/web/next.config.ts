import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"
import createMDX from "@next/mdx"

const withNextIntl = createNextIntlPlugin("./i18n/request.ts")
const withMDX = createMDX({ extension: /\.mdx$/ })

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "js", "jsx", "md", "mdx"],
}

export default withNextIntl(withMDX(nextConfig))
