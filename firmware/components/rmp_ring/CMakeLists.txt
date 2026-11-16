idf_component_register(
    SRCS "rmp_ring.cpp"
    INCLUDE_DIRS "include"
    REQUIRES esp_partition nvs_flash rmp_types
)

