idf_component_register(
    SRCS "app_main.cpp"
    INCLUDE_DIRS "."
    REQUIRES rmp_types rmp_rtd rmp_motor rmp_dwin rmp_buttons rmp_net rmp_mqtt rmp_audio rmp_prov rmp_ring rmp_time driver vfs esp_timer esp_system
    EMBED_TXTFILES "certs/ca.crt" "certs/device.crt" "certs/device.key"
)
