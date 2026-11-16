idf_component_register(
    SRCS "rmp_net.cpp"
    INCLUDE_DIRS "include"
    REQUIRES rmp_types rmp_prov esp_wifi esp_netif esp_event nvs_flash esp_http_server lwip
)
