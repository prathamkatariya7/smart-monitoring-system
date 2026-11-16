idf_component_register(
    SRCS "rmp_time.cpp"
    INCLUDE_DIRS "include"
    REQUIRES esp_netif lwip esp_timer rmp_types
)

